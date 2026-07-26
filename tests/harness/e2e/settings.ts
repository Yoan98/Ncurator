import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Locator, Page } from 'playwright'
import type {
  WorkspaceIndexJobRecord,
  WorkspaceListItem,
  WorkspaceTreeListResponse
} from '../../../src/shared/types'
import {
  importSelectors,
  settingsSelectors,
  vectorSelectors
} from '../../../src/renderer/src/testing/selectors'
import { selectDirectoryInWindowsDialog } from './windowsNativeDialog'

export type SettingsPageTarget = 'general' | 'model' | 'workspace' | 'vector'

export const SETTINGS_E2E_TIMEOUT_MS = 60_000
export const SETTINGS_LONG_E2E_TIMEOUT_MS = 120_000
export const SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS = 180_000
export const SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS = 360_000
export const SETTINGS_WEB_E2E_TIMEOUT_MS = 120_000
const execFileAsync = promisify(execFile)
const MACOS_ELECTRON_BUNDLE_ID = 'com.github.Electron'
const MACOS_ELECTRON_PROCESS_NAME = 'Electron'
const NATIVE_DIALOG_APPLESCRIPT_PATH = path.join(
  os.tmpdir(),
  'ncurator-settings-select-directory.applescript'
)
const NATIVE_DIALOG_APPLESCRIPT = `
on run argv
  set targetPath to item 1 of argv
  set targetPid to (item 2 of argv) as integer
  set targetBundleId to item 3 of argv
  set fallbackProcessName to item 4 of argv
  set beforeFrontmost to ""
  set afterFrontmost to ""
  set targetProcessName to ""
  set targetProcessCount to 0
  set keyStatus to "not-run"
  set clickedConfirmButton to false

  tell application "System Events"
    set beforeFrontmost to name of first application process whose frontmost is true
    repeat 12 times
      set targetProcesses to application processes whose unix id is targetPid
      if (count of targetProcesses) is 0 then
        set targetProcesses to application processes whose bundle identifier is targetBundleId
      end if
      if (count of targetProcesses) is 0 then
        set targetProcesses to application processes whose name is fallbackProcessName
      end if
      set targetProcessCount to count of targetProcesses
      if (count of targetProcesses) is greater than 0 then
        set targetProcess to item 1 of targetProcesses
        set targetProcessName to name of targetProcess
        set frontmost of targetProcess to true
        try
          perform action "AXRaise" of window 1 of targetProcess
        end try
        delay 0.05
        if (name of first application process whose frontmost is true) is targetProcessName then
          exit repeat
        end if
      end if
      delay 0.05
    end repeat
    delay 0.1
    set afterFrontmost to name of first application process whose frontmost is true
  end tell

  if targetProcessName is not "" and afterFrontmost is targetProcessName then
    tell application "System Events"
      key code 5 using {command down, shift down}
      repeat 12 times
        delay 0.05
        try
          if exists sheet 1 of window 1 of targetProcess then exit repeat
        end try
      end repeat
      delay 0.2
      set the clipboard to targetPath
      key code 9 using {command down}
      delay 0.15
      key code 36
      set keyStatus to "sent"
      delay 0.8
      set candidateButtons to {"选择此目录", "选择", "打开", "Choose", "Open"}
      repeat with candidateButton in candidateButtons
        try
          click button (candidateButton as text) of sheet 1 of window 1 of targetProcess
          set keyStatus to "sent-clicked-" & (candidateButton as text)
          set clickedConfirmButton to true
          exit repeat
        end try
        try
          click button (candidateButton as text) of window 1 of targetProcess
          set keyStatus to "sent-clicked-" & (candidateButton as text)
          set clickedConfirmButton to true
          exit repeat
        end try
      end repeat
      if clickedConfirmButton is false then
        key code 36
        set keyStatus to "sent-return-fallback"
      end if
    end tell
  else
    set keyStatus to "skipped-not-frontmost"
  end if

  return "frontmost-before=" & beforeFrontmost & "; frontmost-after=" & afterFrontmost & "; target-process-name=" & targetProcessName & "; target-process-count=" & targetProcessCount & "; key-status=" & keyStatus
end run
`
type SettingsE2EWindow = Window & {
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
}

type WorkspaceCreateUiResponse = {
  success: boolean
  workspace?: WorkspaceListItem
  error?: string
}

export type LocalSettingsHttpServer = {
  origin: string
  url: (pathname?: string) => string
  close: () => Promise<void>
}

type LocalSettingsHttpResponse = {
  status?: number
  body: string
  contentType?: string
  delayMs?: number
}

type LocalSettingsHttpRoute = LocalSettingsHttpResponse & {
  responses?: readonly LocalSettingsHttpResponse[]
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

const SETTINGS_TARGET_HEADINGS: Record<SettingsPageTarget, string> = {
  general: '通用',
  model: '大模型',
  workspace: '工作空间',
  vector: '向量模型'
}

const SETTINGS_TARGET_HASHES: Record<SettingsPageTarget, string> = {
  general: '#/settings/general',
  model: '#/settings/model',
  workspace: '#/settings/workspace',
  vector: '#/model-download'
}

const SETTINGS_TARGET_SELECTORS: Record<SettingsPageTarget, string> = {
  general: settingsSelectors.generalPanel,
  model: settingsSelectors.page,
  workspace: settingsSelectors.page,
  vector: vectorSelectors.page
}

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export const startLocalSettingsHttpServer = async (
  routes: Record<string, LocalSettingsHttpRoute>
): Promise<LocalSettingsHttpServer> => {
  const requestCounts = new Map<string, number>()
  const server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname
    const route = routes[pathname] || routes['/']
    if (!route) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('not found')
      return
    }
    const requestCount = requestCounts.get(pathname) || 0
    requestCounts.set(pathname, requestCount + 1)
    const routeResponse = route.responses?.length
      ? route.responses[Math.min(requestCount, route.responses.length - 1)]
      : route
    const respond = (): void => {
      response.writeHead(routeResponse.status || 200, {
        'content-type': routeResponse.contentType || 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      })
      response.end(routeResponse.body)
    }
    if (routeResponse.delayMs && routeResponse.delayMs > 0) {
      setTimeout(respond, routeResponse.delayMs)
      return
    }
    respond()
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('failed to start local settings http server')
  }

  const origin = `http://127.0.0.1:${String((address as AddressInfo).port)}`
  return {
    origin,
    url: (pathname = '/') => `${origin}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    close: async () => {
      await closeServer(server)
    }
  }
}

export const getSettingsLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getSettingsPrefixLocator = (page: Page, testIdPrefix: string): Locator =>
  page.locator(byTestIdPrefix(testIdPrefix))

const readElectronProcessId = async (page: Page): Promise<number | null> =>
  page
    .evaluate(() => {
      const currentWindow = window as SettingsE2EWindow
      return currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ || null
    })
    .catch(() => null)

const selectDirectoryInNativeDialog = async (
  directoryPath: string,
  electronProcessId: number | null
): Promise<string> => {
  if (process.platform === 'win32') {
    return await selectDirectoryInWindowsDialog(directoryPath, electronProcessId)
  }
  if (process.platform !== 'darwin') throw new Error(`unsupported platform: ${process.platform}`)
  if (!electronProcessId) {
    throw new Error('native directory dialog automation requires Electron process id')
  }
  await writeFile(NATIVE_DIALOG_APPLESCRIPT_PATH, NATIVE_DIALOG_APPLESCRIPT, 'utf8')
  const output = await execFileAsync(
    '/usr/bin/osascript',
    [
      NATIVE_DIALOG_APPLESCRIPT_PATH,
      directoryPath,
      String(electronProcessId),
      MACOS_ELECTRON_BUNDLE_ID,
      MACOS_ELECTRON_PROCESS_NAME
    ],
    {
      timeout: 30_000
    }
  )
  return `${output.stdout}\n${output.stderr}`.trim()
}

const waitForWorkspaceRootPathVisible = async (
  page: Page,
  rootPath: string,
  timeoutMs = 12_000
): Promise<boolean> =>
  await page
    .waitForFunction(
      (input: { detailTestId: string; cardPrefix: string; rootPath: string }) => {
        const normalize = (value: string): string => value.replace(/\s+/g, '')
        const expected = normalize(input.rootPath)
        const detail = document.querySelector(`[data-testid="${input.detailTestId}"]`)
        const cards = Array.from(document.querySelectorAll(`[data-testid^="${input.cardPrefix}-"]`))
        return [detail, ...cards].some(
          (node) => node instanceof HTMLElement && normalize(node.innerText).includes(expected)
        )
      },
      {
        detailTestId: importSelectors.workspaceDetail,
        cardPrefix: importSelectors.workspaceCardPrefix,
        rootPath
      },
      { timeout: timeoutMs }
    )
    .then(() => true)
    .catch(() => false)

export const readWorkspaceIdFromSettingsCard = async (
  page: Page,
  workspaceName: string
): Promise<string> => {
  const card = getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
    .filter({ hasText: workspaceName })
    .first()
  await card.waitFor({ state: 'visible' })
  const testId = await card.getAttribute('data-testid')
  const prefix = `${importSelectors.workspaceCardPrefix}-`
  if (!testId?.startsWith(prefix)) {
    throw new Error(`failed to read workspace id from Settings card for "${workspaceName}"`)
  }
  return testId.slice(prefix.length)
}

export const navigateToSettingsSection = async (
  page: Page,
  section: SettingsPageTarget
): Promise<void> => {
  await page.evaluate((nextHash: string) => {
    window.location.hash = nextHash
  }, SETTINGS_TARGET_HASHES[section])
  await getSettingsLocator(page, SETTINGS_TARGET_SELECTORS[section]).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: SETTINGS_TARGET_HEADINGS[section] }).first().waitFor({
    state: 'visible'
  })
}

export const createModelConfigThroughSettingsUi = async (
  page: Page,
  input: { name?: string; baseUrl: string; apiKey: string }
): Promise<void> => {
  await navigateToSettingsSection(page, 'model')
  await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
  await getSettingsLocator(page, settingsSelectors.modelNameInput).fill(input.name || input.baseUrl)
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({ state: 'visible' })
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
    .locator('input')
    .fill(input.baseUrl)
  await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(input.apiKey)
  await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
  await page
    .locator('tbody tr')
    .filter({ hasText: input.name || input.baseUrl })
    .waitFor({ state: 'visible' })
}

export const createWorkspaceThroughSettingsUi = async (
  page: Page,
  workspaceName: string
): Promise<string> => {
  await navigateToSettingsSection(page, 'workspace')
  await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
  await getSettingsLocator(page, importSelectors.createWorkspaceNameInput).fill(workspaceName)
  await getSettingsLocator(page, importSelectors.createWorkspaceConfirmButton).click()
  await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
    .filter({ hasText: workspaceName })
    .first()
    .waitFor({ state: 'visible' })
  await getSettingsLocator(page, importSelectors.workspaceDetail)
    .getByRole('tab', { name: /文件/u })
    .waitFor({ state: 'visible' })
  return await readWorkspaceIdFromSettingsCard(page, workspaceName)
}

export const bindWorkspaceRootThroughSettingsUi = async (
  page: Page,
  rootPath: string
): Promise<void> => {
  await navigateToSettingsSection(page, 'workspace')
  const rootPathButton = page.getByRole('button', { name: /设置工作目录|更换工作目录/u }).first()
  await page.bringToFront()
  await rootPathButton.waitFor({ state: 'visible' })
  const diagnostics: string[] = []
  const attempts = process.platform === 'win32' ? 3 : 4
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1 && (await waitForWorkspaceRootPathVisible(page, rootPath, 1000))) return
    const electronProcessId = await readElectronProcessId(page)
    await rootPathButton.click()
    await page.waitForTimeout(1_000)
    try {
      diagnostics.push(await selectDirectoryInNativeDialog(rootPath, electronProcessId))
      if (await waitForWorkspaceRootPathVisible(page, rootPath)) return
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(
    [
      `failed to select workspace root path through native dialog: ${rootPath}`,
      `diagnostics=${JSON.stringify(diagnostics)}`
    ].join('\n')
  )
}

export const bindWorkspaceRootDirectly = async (
  page: Page,
  workspaceId: string,
  rootPath: string
): Promise<void> => {
  const response = await page.evaluate(
    async (input) => await window.api.workspaceSetRootPath(input),
    { workspaceId, rootPath: path.resolve(rootPath) }
  )
  if (!response.success) {
    throw new Error(
      `failed to bind workspace root through IPC: ${response.error || 'unknown error'}`
    )
  }
}

export const createFixtureWorkspace = async (
  page: Page,
  input: { name: string; rootPath?: string }
): Promise<WorkspaceCreateUiResponse> => {
  const workspaceId = await createWorkspaceThroughSettingsUi(page, input.name)
  if (input.rootPath) {
    const rootPath = path.resolve(input.rootPath)
    await mkdir(rootPath, { recursive: true })
    await bindWorkspaceRootDirectly(page, workspaceId, rootPath)
    await navigateToSettingsSection(page, 'workspace')
    if (!(await waitForWorkspaceRootPathVisible(page, rootPath))) {
      throw new Error(
        `workspace root was bound through ipc but not reflected in settings ui: ${rootPath}`
      )
    }
  }
  const response = await page.evaluate(async () => await window.api.workspaceList())
  const workspace = response.items.find((item) => item.id === workspaceId)
  return {
    success: Boolean(workspace),
    workspace,
    error: workspace ? undefined : 'created workspace was not found'
  }
}

export const createRealWorkspaceWithRoot = async (
  page: Page,
  input: { name: string; rootPath: string }
): Promise<WorkspaceCreateUiResponse> => {
  return await createFixtureWorkspace(page, input)
}

export const addWebSourceThroughSettingsUi = async (page: Page, url: string): Promise<void> => {
  await navigateToSettingsSection(page, 'workspace')
  await page.getByRole('tab', { name: /网页/u }).click()
  await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).click()
  await getSettingsLocator(page, importSelectors.webSourceUrlInput).fill(url)
  await getSettingsLocator(page, importSelectors.webSourceConfirmButton).click()
  await getSettingsLocator(page, importSelectors.webSourceModal).waitFor({ state: 'hidden' })
  await getSettingsLocator(page, importSelectors.webSourceList).getByText(url).first().waitFor({
    state: 'visible'
  })
}

export const seedWebSources = async (
  page: Page,
  _workspaceId: string,
  urls: string[]
): Promise<void> => {
  for (const url of urls) {
    await addWebSourceThroughSettingsUi(page, url)
  }
}

export const readWorkspaceTree = async (
  page: Page,
  workspaceId: string
): Promise<WorkspaceTreeListResponse> =>
  await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspaceTree({
      workspaceId: selectedWorkspaceId,
      includeUnsupported: true
    })
  }, workspaceId)

export const waitForFileIndexJobIdle = async (
  page: Page,
  workspaceId: string,
  timeoutMs = SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
): Promise<{ lastRunningJob?: WorkspaceIndexJobRecord; tree: WorkspaceTreeListResponse }> => {
  const deadline = Date.now() + timeoutMs
  let lastRunningJob: WorkspaceIndexJobRecord | undefined

  for (;;) {
    const response = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceIndexJobGet({
        workspaceId: selectedWorkspaceId,
        sourceKind: 'file'
      })
    }, workspaceId)
    if (!response.success) {
      throw new Error(response.error || 'failed to read file index job')
    }
    if (!response.job) {
      return {
        lastRunningJob,
        tree: await readWorkspaceTree(page, workspaceId)
      }
    }
    lastRunningJob = response.job
    if (Date.now() >= deadline) {
      throw new Error('file index job did not become idle')
    }
    await page.waitForTimeout(500)
  }
}

export const getWorkspaceIndexCounts = async (
  page: Page
): Promise<{ actionableCount: number; failedHint: string }> => {
  const failedHintLocator = getSettingsLocator(page, importSelectors.workspaceActionableFailedHint)
  return {
    actionableCount: Number(
      (await getSettingsLocator(
        page,
        importSelectors.workspaceActionableIndexCount
      ).textContent()) || 0
    ),
    failedHint: (await failedHintLocator.count())
      ? (await failedHintLocator.textContent()) || ''
      : ''
  }
}

export const getWebSourceIndexCounts = async (
  page: Page
): Promise<{ actionableCount: number; failedHint: string }> => {
  return await page.evaluate(
    (selectors) => {
      const actionableCountText = document
        .querySelector(`[data-testid="${selectors.actionableCount}"]`)
        ?.textContent?.trim()
      const failedHint =
        document.querySelector(`[data-testid="${selectors.failedHint}"]`)?.textContent?.trim() || ''
      return {
        actionableCount: Number(actionableCountText || 0),
        failedHint
      }
    },
    {
      actionableCount: importSelectors.webSourceActionableIndexCount,
      failedHint: importSelectors.webSourceActionableFailedHint
    }
  )
}

export const waitForWebIndexJobIdle = async (
  page: Page,
  workspaceId: string,
  timeoutMs = SETTINGS_WEB_E2E_TIMEOUT_MS
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const response = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceIndexJobGet({
        workspaceId: String(selectedWorkspaceId || ''),
        sourceKind: 'web'
      })
    }, workspaceId)
    if (response.success && !response.job) return
    if (Date.now() >= deadline) {
      throw new Error('web index job did not become idle')
    }
    await page.waitForTimeout(100)
  }
}

export const workspaceCardLocator = (page: Page, workspaceId: string): Locator =>
  getSettingsLocator(page, `${importSelectors.workspaceCardPrefix}-${workspaceId}`)
