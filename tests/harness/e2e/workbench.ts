import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import type { Locator, Page } from 'playwright'
import type {
  AiLlmIoRecord,
  AiRunEvent,
  JsonValue,
  WorkspaceIndexJobAction
} from '../../../src/shared/types'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import {
  chatSelectors,
  importSelectors,
  scheduledTaskSelectors,
  settingsSelectors,
  workbenchSelectors
} from '../../../src/renderer/src/testing/selectors'
import { resolveLiveLlmTarget, type LiveLlmTarget } from '../core/liveProviders'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createPresetModelConfigThroughSettingsUi,
  getWorkspaceIndexCounts,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection
} from './settings'
import { selectDirectoryInWindowsDialog } from './windowsNativeDialog'
import type { E2ETestRuntime } from './run-e2e-case'
import {
  pasteTextThroughElectronClipboard,
  queueE2ENativeDialogSelection,
  type E2ERuntimeSignals
} from './electronApp'
import {
  E2E_WORKSPACE_FIXTURE_ROOT,
  copyE2EWorkspaceFixture,
  type TemporaryE2EWorkspace
} from './workspaceFixture'

export const WORKBENCH_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS
export const WORKBENCH_LONG_E2E_TIMEOUT_MS = SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
export const WORKBENCH_RESULT_E2E_TIMEOUT_MS = WORKBENCH_LONG_E2E_TIMEOUT_MS + 120_000
export const WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS = 900_000
export const WORKBENCH_MODEL_LIST_TIMEOUT_MS = 60_000
export const WORKBENCH_FIXTURE_ROOT = E2E_WORKSPACE_FIXTURE_ROOT
/** Matches ChatPage create/edit partner Input maxLength. */
export const WORKBENCH_PARTNER_NAME_MAX_LENGTH = 40

export const clampWorkbenchPartnerName = (name: string): string =>
  name.trim().slice(0, WORKBENCH_PARTNER_NAME_MAX_LENGTH)

export type WorkbenchLiveModelEnv = LiveLlmTarget

export type TemporaryWorkbenchWorkspace = TemporaryE2EWorkspace

export type LocalWorkbenchHttpServer = {
  url: string
  close: () => Promise<void>
}

type LocalWorkbenchHttpServerOptions = {
  onRequest?: (requestUrl: string) => boolean
}

export type WorkbenchSetupResult = {
  env: WorkbenchLiveModelEnv
  workspace: TemporaryWorkbenchWorkspace
  workspaceName: string
}

export type WorkbenchWorkspaceOnlySetupResult = {
  workspace: TemporaryWorkbenchWorkspace
  workspaceName: string
}

export type WorkbenchAiCompletionEvidence = {
  modelName: string
  durationMs: number
  events: AiRunEvent[]
  finalAnswerText: string
}

export type WorkbenchRunBlockerPolicy = 'fail' | 'auto_approve'

export type WorkbenchRunBlockedResult = {
  kind: 'approval'
  event: Extract<AiRunEvent, { type: 'approval_batch_required' }>
  assistantTextSoFar: string
  cardText: string
}

export type WorkbenchAiRunOutcome =
  | {
      status: 'completed'
      evidence: WorkbenchAiCompletionEvidence
    }
  | {
      status: 'blocked'
      blocked: WorkbenchRunBlockedResult
    }

type WorkbenchDraftSubmitState = {
  inputText: string
  tokenTexts: string[]
  sendButtonDisabled: boolean | null
  sendButtonText: string
}

export {
  chatSelectors,
  importSelectors,
  scheduledTaskSelectors,
  settingsSelectors,
  workbenchSelectors
}

export const dismissWorkbenchLlmConfigMissingNotification = async (page: Page): Promise<void> => {
  const card = getWorkbenchLocator(page, workbenchSelectors.llmConfigMissingNotification)
  if (!(await card.isVisible().catch(() => false))) return
  await card.getByRole('button', { name: '稍后', exact: true }).click()
  await card.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined)
}

export const ensureWorkbenchContentPanelExpanded = async (page: Page): Promise<void> => {
  const panelReady = async (): Promise<boolean> =>
    page.evaluate((testId) => {
      const shell = document.querySelector(`[data-testid="${testId}"]`)
      return (
        shell instanceof HTMLElement &&
        shell.dataset.panelVisible === 'true' &&
        shell.getBoundingClientRect().width > 100
      )
    }, workbenchSelectors.contentPanelShell)

  if (await panelReady()) return

  // Partner switch collapses with a short unmount delay; wait so the expand toggle reappears.
  await page
    .waitForFunction(
      (testId) => {
        const shell = document.querySelector(`[data-testid="${testId}"]`)
        if (!(shell instanceof HTMLElement)) return true
        return shell.dataset.panelVisible !== 'true'
      },
      workbenchSelectors.contentPanelShell,
      { timeout: 5_000 }
    )
    .catch(() => undefined)

  if (await panelReady()) return

  const toggle = getWorkbenchLocator(page, workbenchSelectors.contentPanelToggle)
  await toggle.waitFor({ state: 'visible', timeout: 10_000 })
  if ((await toggle.getAttribute('aria-label')) === '展开右侧栏') {
    await toggle.click()
  }
  await page.waitForFunction(
    (testId) => {
      const shell = document.querySelector(`[data-testid="${testId}"]`)
      return (
        shell instanceof HTMLElement &&
        shell.dataset.panelVisible === 'true' &&
        shell.getBoundingClientRect().width > 100
      )
    },
    workbenchSelectors.contentPanelShell,
    { timeout: 10_000 }
  )
}

export const selectWorkbenchResourceMenuItem = async (
  runtime: E2ETestRuntime,
  kind: 'file' | 'browser'
): Promise<{ fileVisible: boolean; browserVisible: boolean }> => {
  await dismissWorkbenchLlmConfigMissingNotification(runtime.page)
  await ensureWorkbenchContentPanelExpanded(runtime.page)
  const initialTabCount = await getWorkbenchPrefixLocator(
    runtime.page,
    workbenchSelectors.resourceTabPrefix
  ).count()
  const addButton = getWorkbenchLocator(runtime.page, workbenchSelectors.resourceTabAddButton)
  await addButton.waitFor({ state: 'visible' })
  const menuWindowPromise = runtime.electronApp.waitForEvent('window')
  await addButton.click()
  const menuPage = await menuWindowPromise
  await menuPage.waitForLoadState('domcontentloaded')
  const fileItem = menuPage.getByRole('menuitem', { name: '文件', exact: true })
  const browserItem = menuPage.getByRole('menuitem', { name: '浏览器', exact: true })
  await fileItem.waitFor({ state: 'visible', timeout: 10_000 })
  const result = {
    fileVisible: await fileItem.isVisible(),
    browserVisible: await browserItem.isVisible()
  }
  const closePromise = menuPage.waitForEvent('close').catch(() => undefined)
  try {
    await (kind === 'file' ? fileItem : browserItem).click()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/Target page, context or browser has been closed/u.test(message)) throw error
  }
  await closePromise
  await runtime.page.waitForFunction(
    ({ prefix, initialCount }) =>
      document.querySelectorAll(`[data-testid^="${prefix}-"]`).length > initialCount,
    { prefix: workbenchSelectors.resourceTabPrefix, initialCount: initialTabCount },
    { timeout: 10_000 }
  )
  return result
}

export const openWorkbenchWorkspaceFile = async (
  runtime: E2ETestRuntime,
  fileName: string
): Promise<void> => {
  const { page } = runtime
  await dismissWorkbenchLlmConfigMissingNotification(page)
  await ensureWorkbenchContentPanelExpanded(page)
  const filter = page.getByPlaceholder('筛选文件…')
  if (!(await filter.isVisible().catch(() => false))) {
    const explorerToggle = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle)
    if (await explorerToggle.isVisible().catch(() => false)) {
      await explorerToggle.click()
    } else {
      await selectWorkbenchResourceMenuItem(runtime, 'file')
    }
  }
  await filter.waitFor({ state: 'visible' })
  // Clear filter so lazy-loaded parents stay visible for nested fixture paths.
  await filter.evaluate((element) => {
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('workspace file filter is not an input')
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setter?.call(element, '')
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
  })

  const exactTitle = page.getByTitle(fileName, { exact: true })
  if (await exactTitle.isVisible().catch(() => false)) {
    await exactTitle.click()
    return
  }

  const segments = fileName.split(/[\\/]/u).filter(Boolean)
  const basename = segments.at(-1) || fileName
  let prefix = ''
  for (const segment of segments.slice(0, -1)) {
    prefix = prefix ? `${prefix}/${segment}` : segment
    const folder = page.getByTitle(prefix, { exact: true }).first()
    await folder.waitFor({ state: 'visible', timeout: 30_000 })
    await folder.click({ force: true })
    await page.waitForTimeout(200)
  }

  const nestedTitle = prefix ? `${prefix}/${basename}` : basename
  const nested = page.getByTitle(nestedTitle, { exact: true })
  await nested.waitFor({ state: 'visible', timeout: 30_000 })
  await nested.click({ force: true })
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`
const execFileAsync = promisify(execFile)
const NATIVE_DIALOG_APPLESCRIPT_PATH = path.join(
  os.tmpdir(),
  'ncurator-workbench-select-directory.applescript'
)
const NATIVE_DIALOG_APPLESCRIPT = `
on run argv
  set targetPath to item 1 of argv
  set targetPid to (item 2 of argv) as integer
  set targetBundleId to item 3 of argv
  set fallbackProcessName to item 4 of argv
  set inputMode to item 5 of argv
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
      if inputMode is "type" then
        keystroke targetPath
      else
        set the clipboard to targetPath
        key code 9 using {command down}
      end if
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

  return "frontmost-before=" & beforeFrontmost & "; frontmost-after=" & afterFrontmost & "; target-process-name=" & targetProcessName & "; target-process-count=" & targetProcessCount & "; input-mode=" & inputMode & "; key-status=" & keyStatus
end run
`
const NATIVE_DIALOG_SWIFT_SCRIPT_PATH = path.join(
  os.tmpdir(),
  'ncurator-workbench-select-directory.swift'
)
const NATIVE_DIALOG_SWIFT_SCRIPT = `
import AppKit
import ApplicationServices
import Foundation

func postKey(_ keyCode: CGKeyCode, _ flags: CGEventFlags = []) {
  let source = CGEventSource(stateID: .hidSystemState)
  guard let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
        let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false) else {
    return
  }
  keyDown.flags = flags
  keyUp.flags = flags
  keyDown.post(tap: .cghidEventTap)
  keyUp.post(tap: .cghidEventTap)
}

let targetPath = CommandLine.arguments[1]
let processId = pid_t(Int32(CommandLine.arguments[2]) ?? 0)
let bundleIdentifier = CommandLine.arguments[3]

let beforeFrontmost = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
let processApp = NSRunningApplication(processIdentifier: processId)
let bundleApp = NSRunningApplication.runningApplications(withBundleIdentifier: bundleIdentifier).first
let targetApp = processApp ?? bundleApp

if let app = targetApp {
  app.activate(options: [.activateAllWindows])
}

Thread.sleep(forTimeInterval: 0.25)
NSPasteboard.general.clearContents()
NSPasteboard.general.setString(targetPath, forType: .string)

postKey(5, [.maskCommand, .maskShift])
Thread.sleep(forTimeInterval: 0.6)
postKey(9, [.maskCommand])
Thread.sleep(forTimeInterval: 0.15)
postKey(36)
Thread.sleep(forTimeInterval: 0.8)
postKey(36)
Thread.sleep(forTimeInterval: 0.15)

let afterFrontmost = NSWorkspace.shared.frontmostApplication?.localizedName ?? ""
print("frontmost-before=\\(beforeFrontmost); frontmost-after=\\(afterFrontmost); target-app=\\(targetApp?.localizedName ?? "none")")
`

type NativeDirectoryDialogStrategy =
  | 'windows-keyboard'
  | 'applescript-paste'
  | 'applescript-type'
  | 'swift'

type NativeDirectoryDialogResult = {
  strategy: NativeDirectoryDialogStrategy
  stdout: string
  stderr: string
}

type NativeDirectoryDialogDiagnostics = {
  strategy: NativeDirectoryDialogStrategy
  selected: boolean
  stdout: string
  stderr: string
  error?: string
}

const MACOS_ELECTRON_BUNDLE_ID = 'com.github.Electron'
const MACOS_ELECTRON_PROCESS_NAME = 'Electron'

const closeServer = async (server: Server): Promise<void> => {
  const forceCloseTimer = setTimeout(() => {
    const closeableServer = server as Server & {
      closeAllConnections?: () => void
      closeIdleConnections?: () => void
    }
    closeableServer.closeIdleConnections?.()
    closeableServer.closeAllConnections?.()
  }, 1000)
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      clearTimeout(forceCloseTimer)
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const waitForCondition = async (input: {
  name: string
  timeoutMs: number
  intervalMs?: number
  check: () => Promise<boolean>
}): Promise<void> => {
  const deadline = Date.now() + input.timeoutMs
  const intervalMs = input.intervalMs || 500
  for (;;) {
    if (await input.check()) return
    if (Date.now() >= deadline) {
      throw new Error(`${input.name} timed out`)
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, intervalMs)
    })
  }
}

export const getWorkbenchLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getWorkbenchPrefixLocator = (page: Page, testIdPrefix: string): Locator =>
  page.locator(byTestIdPrefix(testIdPrefix))

export const loadWorkbenchLiveModelEnv = (): WorkbenchLiveModelEnv => {
  try {
    return resolveLiveLlmTarget()
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(
      [
        'Workbench formal AI e2e 缺少内置服务商 live 配置。',
        '请设置 AI_LIVE_KEY_<PROVIDER>（如 AI_LIVE_KEY_DASHSCOPE），',
        '可选 AI_LIVE_PROVIDER / AI_LIVE_MODEL（默认 dashscope + qwen3.8-flash）。',
        detail
      ].join('\n')
    )
  }
}

export const createTemporaryWorkbenchWorkspace = async (
  caseId: string
): Promise<TemporaryWorkbenchWorkspace> => await copyE2EWorkspaceFixture(caseId, 'workbench')

export const startLocalWorkbenchHttpServer = async (
  html: string,
  options: LocalWorkbenchHttpServerOptions = {}
): Promise<LocalWorkbenchHttpServer> => {
  const server = createServer((request, response) => {
    const requestUrl = request.url || '/'
    if (options.onRequest?.(requestUrl)) {
      response.writeHead(204)
      response.end()
      return
    }
    if (requestUrl === '/' || requestUrl.startsWith('/task')) {
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      })
      response.end(html)
      return
    }
    response.writeHead(404, {
      'content-type': 'text/plain; charset=utf-8'
    })
    response.end('not found')
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
    throw new Error('failed to start local workbench http server')
  }

  return {
    url: `http://127.0.0.1:${String((address as AddressInfo).port)}/task`,
    close: async () => {
      await closeServer(server)
    }
  }
}

export const navigateToWorkbench = async (
  page: Page,
  options?: { waitForSessionListText?: boolean }
): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await getWorkbenchLocator(page, workbenchSelectors.page).waitFor({ state: 'visible' })
  await getWorkbenchLocator(page, workbenchSelectors.partnersList).waitFor({ state: 'visible' })
  if (options?.waitForSessionListText !== false) {
    await waitForCondition({
      name: 'workbench partner list ready',
      timeoutMs: WORKBENCH_E2E_TIMEOUT_MS,
      check: async () => {
        const hydrated = await getWorkbenchLocator(page, workbenchSelectors.partnersList)
          .getAttribute('data-hydrated')
          .catch(() => null)
        return hydrated === 'true'
      }
    })
  }
  await getWorkbenchLocator(page, workbenchSelectors.input)
    .or(page.getByText('还没有伙伴。从左侧创建一个开始对话。'))
    .or(page.getByText('请选择一个伙伴开始对话。'))
    .waitFor({ state: 'visible' })
}

export const configureLiveModelThroughSettingsUi = async (
  page: Page,
  env: WorkbenchLiveModelEnv = loadWorkbenchLiveModelEnv()
): Promise<void> => {
  await createPresetModelConfigThroughSettingsUi(page, {
    providerId: env.providerId,
    apiKey: env.apiKey
  })
}

export const createWorkspaceThroughSettingsUi = async (
  page: Page,
  rootPath: string
): Promise<string> => {
  await navigateToSettingsSection(page, 'workspace')
  const resolvedRootPath = path.resolve(rootPath)
  const response = await page.evaluate(
    async (workspaceRootPath) => await window.api.workspaceCreate({ rootPath: workspaceRootPath }),
    resolvedRootPath
  )
  if (!response.success || !response.workspace) {
    throw new Error(response.error || 'failed to add workspace root')
  }
  const displayName = path.basename(resolvedRootPath)
  await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
    .filter({ hasText: displayName })
    .first()
    .waitFor({ state: 'visible' })
  return response.workspace.id
}

type WorkbenchE2EWindow = Window & {
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
}

const readElectronProcessId = async (page: Page): Promise<number | null> =>
  page
    .evaluate(() => {
      const currentWindow = window as WorkbenchE2EWindow
      return currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ || null
    })
    .catch(() => null)

export const selectDirectoryInNativeDialog = async (
  directoryPath: string,
  electronProcessId: number | null,
  strategy: NativeDirectoryDialogStrategy
): Promise<NativeDirectoryDialogResult> => {
  if (strategy === 'windows-keyboard') {
    return {
      strategy,
      stdout: await selectDirectoryInWindowsDialog(directoryPath, electronProcessId),
      stderr: ''
    }
  }
  if (process.platform !== 'darwin') throw new Error(`unsupported platform: ${process.platform}`)
  if (!electronProcessId) {
    throw new Error('native directory dialog automation requires Electron process id')
  }

  if (strategy === 'applescript-paste' || strategy === 'applescript-type') {
    await writeFile(NATIVE_DIALOG_APPLESCRIPT_PATH, NATIVE_DIALOG_APPLESCRIPT, 'utf8')
    const output = await execFileAsync(
      '/usr/bin/osascript',
      [
        NATIVE_DIALOG_APPLESCRIPT_PATH,
        directoryPath,
        String(electronProcessId),
        MACOS_ELECTRON_BUNDLE_ID,
        MACOS_ELECTRON_PROCESS_NAME,
        strategy === 'applescript-type' ? 'type' : 'paste'
      ],
      {
        timeout: 30_000
      }
    )
    return {
      strategy,
      stdout: output.stdout,
      stderr: output.stderr
    }
  }

  await writeFile(NATIVE_DIALOG_SWIFT_SCRIPT_PATH, NATIVE_DIALOG_SWIFT_SCRIPT, 'utf8')
  const output = await execFileAsync(
    '/usr/bin/swift',
    [
      NATIVE_DIALOG_SWIFT_SCRIPT_PATH,
      directoryPath,
      String(electronProcessId),
      MACOS_ELECTRON_BUNDLE_ID
    ],
    {
      timeout: 30_000
    }
  )
  return {
    strategy,
    stdout: output.stdout,
    stderr: output.stderr
  }
}

export const bindWorkspaceRootThroughSettingsUi = async (
  page: Page,
  rootPath: string
): Promise<void> => {
  const rootPathButton = page.getByRole('button', { name: /设置工作目录|更换工作目录/u }).first()
  await page.bringToFront()
  await rootPathButton.waitFor({ state: 'visible' })
  const diagnostics: NativeDirectoryDialogDiagnostics[] = []
  const waitForSelectedRootPath = async (timeoutMs: number): Promise<boolean> =>
    await page
      .waitForFunction(
        (input: { detailTestId: string; cardPrefix: string; rootPath: string }) => {
          const normalize = (value: string): string => value.replace(/\s+/g, '')
          const expected = normalize(input.rootPath)
          const detail = document.querySelector(`[data-testid="${input.detailTestId}"]`)
          const cards = Array.from(
            document.querySelectorAll(`[data-testid^="${input.cardPrefix}-"]`)
          )
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
      .catch(async () => {
        return await page
          .evaluate(async (expectedRootPath) => {
            const normalize = (value: string): string => value.replace(/\/+$/u, '')
            const expected = normalize(String(expectedRootPath || '').trim())
            const response = await window.api.workspaceList()
            return response.items.some(
              (workspace) => normalize(String(workspace.root_path || '').trim()) === expected
            )
          }, rootPath)
          .catch(() => false)
      })

  if (process.platform !== 'win32' && process.platform !== 'darwin') {
    throw new Error(`unsupported platform: ${process.platform}`)
  }

  const strategies: NativeDirectoryDialogStrategy[] =
    process.platform === 'win32'
      ? ['windows-keyboard']
      : ['applescript-paste', 'applescript-type', 'swift']

  const attempts = process.platform === 'win32' ? 1 : strategies.length
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const strategy = strategies[Math.min(attempt, strategies.length - 1)]
    if (attempt > 0 && (await waitForSelectedRootPath(1_000))) return
    const electronProcessId = await readElectronProcessId(page)
    await queueE2ENativeDialogSelection(page, { kind: 'directory', path: rootPath })
    await rootPathButton.click()
    try {
      const output =
        process.platform === 'win32'
          ? { strategy, stdout: 'e2e-native-dialog-selection', stderr: '' }
          : await (async () => {
              await page.waitForTimeout(1_000)
              return await selectDirectoryInNativeDialog(rootPath, electronProcessId, strategy)
            })()
      const selected = await waitForSelectedRootPath(12_000)
      diagnostics.push({
        strategy: output.strategy,
        selected,
        stdout: output.stdout.trim(),
        stderr: output.stderr.trim()
      })
      if (selected) return
    } catch (error) {
      diagnostics.push({
        strategy,
        selected: false,
        stdout: '',
        stderr: '',
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  throw new Error(
    [
      `failed to select workspace root path through native dialog: ${rootPath}`,
      `diagnostics=${JSON.stringify(diagnostics)}`
    ].join('\n')
  )
}

const selectWorkbenchPathThroughNativeDialog = async (
  page: Page,
  filePath: string,
  kind: 'file' | 'directory'
): Promise<void> => {
  const addButton = getWorkbenchLocator(page, workbenchSelectors.attachmentAddButton)
  const fileName = path.basename(filePath)
  const diagnostics: string[] = []
  const alreadyVisible = await getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.attachmentCardPrefix
  )
    .filter({ hasText: fileName })
    .first()
    .isVisible()
    .catch(() => false)
  if (alreadyVisible) return
  // Native dialogs are owned by the operating system and cannot be controlled reliably in headful
  // macOS runs. The main process consumes this E2E-only selection through the same IPC handler
  // that imports real attachment paths.
  await addButton.waitFor({ state: 'visible' })
  await page.waitForFunction(
    (testId) => {
      const button = document.querySelector(`[data-testid="${testId}"]`)
      return button instanceof HTMLButtonElement && !button.disabled
    },
    workbenchSelectors.attachmentAddButton,
    { timeout: WORKBENCH_E2E_TIMEOUT_MS }
  )
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await queueE2ENativeDialogSelection(page, { kind, path: filePath })
    await addButton.click()
    try {
      diagnostics.push(`e2e-native-dialog-selection:${String(attempt + 1)}`)
      await page.waitForFunction(
        (input: { cardPrefix: string; fileName: string }) =>
          Array.from(document.querySelectorAll(`[data-testid^="${input.cardPrefix}-"]`)).some(
            (card) =>
              card instanceof HTMLElement &&
              (card.innerText.includes(input.fileName) ||
                card.getAttribute('title') === input.fileName)
          ),
        {
          cardPrefix: workbenchSelectors.attachmentCardPrefix,
          fileName
        },
        { timeout: 6_000 }
      )
      return
    } catch (error) {
      diagnostics.push(error instanceof Error ? error.message : String(error))
      if (attempt === 0) await page.waitForTimeout(250)
    }
  }
  throw new Error(
    `native file selection did not create attachment ${fileName}; diagnostics=${JSON.stringify(diagnostics)}`
  )
}

export const selectWorkbenchAttachmentThroughNativeDialog = async (
  page: Page,
  filePath: string
): Promise<void> => selectWorkbenchPathThroughNativeDialog(page, filePath, 'file')

export const selectWorkbenchDirectoryThroughNativeDialog = async (
  page: Page,
  directoryPath: string
): Promise<void> => selectWorkbenchPathThroughNativeDialog(page, directoryPath, 'directory')

export const waitForSettingsCountToBecome = async (
  page: Page,
  testId: string,
  expectedCount: number,
  timeoutMs = WORKBENCH_LONG_E2E_TIMEOUT_MS
): Promise<void> => {
  await page.waitForFunction(
    (input: { testId: string; expectedCount: number }) => {
      const text = document.querySelector(`[data-testid="${input.testId}"]`)?.textContent || ''
      return Number(text.trim() || 0) === input.expectedCount
    },
    {
      testId,
      expectedCount
    },
    { timeout: timeoutMs }
  )
}

const waitForSettingsCountAbove = async (
  page: Page,
  testId: string,
  minimumCount: number,
  timeoutMs = WORKBENCH_LONG_E2E_TIMEOUT_MS
): Promise<void> => {
  await page.waitForFunction(
    (input: { testId: string; minimumCount: number }) => {
      const text = document.querySelector(`[data-testid="${input.testId}"]`)?.textContent || ''
      return Number(text.trim() || 0) > input.minimumCount
    },
    {
      testId,
      minimumCount
    },
    { timeout: timeoutMs }
  )
}

const waitForButtonEnabled = async (locator: Locator): Promise<void> => {
  await locator.waitFor({ state: 'visible' })
  await locator
    .page()
    .waitForFunction(
      (element) => element instanceof HTMLButtonElement && !element.disabled,
      await locator.elementHandle(),
      { timeout: WORKBENCH_LONG_E2E_TIMEOUT_MS }
    )
}

const waitForWorkspaceFileJobCycle = async (
  page: Page,
  workspaceId: string,
  action: WorkspaceIndexJobAction
): Promise<void> => {
  const deadline = Date.now() + WORKBENCH_LONG_E2E_TIMEOUT_MS
  const startedAt = Date.now()
  let sawExpectedJob = false
  for (;;) {
    const response = await page.evaluate(
      async (input: { workspaceId: string }) =>
        await window.api.workspaceIndexJobGet({
          workspaceId: input.workspaceId,
          sourceKind: 'file'
        }),
      { workspaceId }
    )
    if (!response.success) {
      throw new Error(response.error || 'failed to read workspace file index job')
    }
    if (response.job?.action === action) {
      sawExpectedJob = true
    }
    if (sawExpectedJob && !response.job) return
    if (!sawExpectedJob && !response.job && Date.now() - startedAt > 3000) return
    if (Date.now() >= deadline) {
      throw new Error(`workspace file ${action} job did not finish`)
    }
    await page.waitForTimeout(500)
  }
}

export const prepareSelectedWorkspaceFilesThroughSettingsUi = async (
  page: Page,
  workspaceId: string
): Promise<void> => {
  const scanButton = getSettingsLocator(page, importSelectors.workspaceQuickScanButton)
  const prepareButton = getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton)
  await waitForButtonEnabled(scanButton)
  await scanButton.click()
  await waitForWorkspaceFileJobCycle(page, workspaceId, 'scan')
  await waitForSettingsCountAbove(
    page,
    importSelectors.workspaceActionableIndexCount,
    0,
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
  await waitForButtonEnabled(prepareButton)
  await prepareButton.click()
  await waitForWorkspaceFileJobCycle(page, workspaceId, 'prepare')
  await waitForSettingsCountToBecome(
    page,
    importSelectors.workspaceActionableIndexCount,
    0,
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
  const counts = await getWorkspaceIndexCounts(page)
  if (counts.actionableCount !== 0 || counts.failedHint) {
    throw new Error(`workspace file indexing did not finish cleanly: ${JSON.stringify(counts)}`)
  }
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

export const prepareSelectedWorkspaceWebSourcesThroughSettingsUi = async (
  page: Page
): Promise<void> => {
  await navigateToSettingsSection(page, 'workspace')
  await page.getByRole('tab', { name: /网页/u }).click()
  const section = getSettingsLocator(page, importSelectors.webSourceSection)
  const prepareButton = section.getByRole('button', { name: '更新索引' })
  await prepareButton.waitFor({ state: 'visible' })
  const actionableText =
    (await getSettingsLocator(page, importSelectors.webSourceActionableIndexCount).textContent()) ||
    '0'
  if (Number(actionableText.trim() || 0) === 0) return
  await prepareButton.click()
  await waitForSettingsCountToBecome(
    page,
    importSelectors.webSourceActionableIndexCount,
    0,
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
}

export const prepareWorkbenchWorkspaceThroughUi = async (
  page: Page,
  input: {
    workspaceName: string
    rootPath: string
    webSourceUrl?: string
  }
): Promise<void> => {
  const workspaceId = await createWorkspaceThroughSettingsUi(page, input.rootPath)
  await prepareSelectedWorkspaceFilesThroughSettingsUi(page, workspaceId)
  if (input.webSourceUrl) {
    await addWebSourceThroughSettingsUi(page, input.webSourceUrl)
    await prepareSelectedWorkspaceWebSourcesThroughSettingsUi(page)
  }
  await navigateToWorkbench(page)
}

export const waitForVisiblePartnerRow = async (page: Page, name: string): Promise<void> => {
  const partnerName = clampWorkbenchPartnerName(name)
  await getWorkbenchPrefixLocator(page, workbenchSelectors.partnerItemPrefix)
    .filter({ hasText: partnerName })
    .first()
    .waitFor({ state: 'visible' })
}

export const createPartnerThroughWorkbenchUi = async (
  page: Page,
  name = '测试伙伴'
): Promise<string> => {
  const partnerName = clampWorkbenchPartnerName(name)
  if (!partnerName) {
    throw new Error('partner name is required')
  }
  await getWorkbenchLocator(page, workbenchSelectors.newPartnerButton).click()
  const nameInput = getWorkbenchLocator(page, workbenchSelectors.createPartnerNameInput)
  await nameInput.waitFor({ state: 'visible' })
  await nameInput.fill(partnerName)
  await nameInput.press('Enter')
  await waitForVisiblePartnerRow(page, partnerName)
  await dismissWorkbenchLlmConfigMissingNotification(page)
  return partnerName
}

export const setupWorkbenchWithTempWorkspace = async (
  page: Page,
  input: {
    caseId: string
    workspaceName?: string
    webSourceUrl?: string
    configureModel?: boolean
    createSession?: boolean
    createPartner?: boolean
  }
): Promise<WorkbenchSetupResult> => {
  const env = loadWorkbenchLiveModelEnv()
  const workspace = await createTemporaryWorkbenchWorkspace(input.caseId)
  // Default name doubles as partner title; keep it within the partner Input maxLength.
  const workspaceName = clampWorkbenchPartnerName(
    input.workspaceName || `Workbench ${input.caseId}`
  )
  if (!workspaceName) {
    throw new Error('workspace/partner name is required')
  }
  if (input.configureModel !== false) {
    await configureLiveModelThroughSettingsUi(page, env)
  }
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath,
    webSourceUrl: input.webSourceUrl
  })
  const shouldCreatePartner = input.createPartner !== false && input.createSession !== false
  if (shouldCreatePartner) {
    await createPartnerThroughWorkbenchUi(page, workspaceName)
  }
  if (input.configureModel !== false && shouldCreatePartner) {
    await selectWorkbenchModel(page, env.modelName)
  }
  return {
    env,
    workspace,
    workspaceName
  }
}

export const setupWorkbenchWorkspaceOnly = async (
  page: Page,
  input: {
    caseId: string
    workspaceName?: string
    webSourceUrl?: string
  }
): Promise<WorkbenchWorkspaceOnlySetupResult> => {
  const workspace = await createTemporaryWorkbenchWorkspace(input.caseId)
  const workspaceName = clampWorkbenchPartnerName(
    input.workspaceName || `Workbench ${input.caseId}`
  )
  if (!workspaceName) {
    throw new Error('workspace/partner name is required')
  }
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath,
    webSourceUrl: input.webSourceUrl
  })
  return {
    workspace,
    workspaceName
  }
}

export const pasteWorkbenchText = async (
  page: Page,
  value: string,
  inputTestId = workbenchSelectors.input
): Promise<void> => {
  let electronClipboardError: string | null = null
  let pastedThroughElectron = false
  try {
    pastedThroughElectron = await pasteTextThroughElectronClipboard(page, value)
  } catch (error) {
    electronClipboardError = error instanceof Error ? error.message : String(error)
  }
  if (pastedThroughElectron) {
    await page.waitForTimeout(100)
    lastWorkbenchPasteDiagnostics = { transport: 'electron-clipboard' }
    return
  }

  // Packaged E2E can run in a Windows session without OS clipboard access. Keep the
  // installed renderer's paste handler under test by dispatching a populated ClipboardEvent.
  const syntheticPaste = await page.evaluate(
    (input: { testId: string; text: string }) => {
      const editor = document.querySelector(`[data-testid="${input.testId}"]`)
      if (!(editor instanceof HTMLElement)) {
        return { dispatched: false, defaultPrevented: false, clipboardTextLength: 0 }
      }

      editor.focus()
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', input.text)
      const pasteEvent = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clipboardData
      })
      editor.dispatchEvent(pasteEvent)
      return {
        dispatched: true,
        defaultPrevented: pasteEvent.defaultPrevented,
        clipboardTextLength: pasteEvent.clipboardData?.getData('text/plain').length || 0
      }
    },
    { testId: inputTestId, text: value }
  )
  lastWorkbenchPasteDiagnostics = {
    transport: 'synthetic-paste-event',
    electronClipboardError,
    ...syntheticPaste
  }
  if (!syntheticPaste.dispatched) {
    throw new Error(
      `failed to dispatch workbench paste event: ${JSON.stringify(lastWorkbenchPasteDiagnostics)}`
    )
  }
  if (!syntheticPaste.defaultPrevented) {
    // The extracted task-description editor does not own the Workbench paste
    // handler. Playwright's native text insertion still exercises its input
    // and mention state without coupling the helper to the chat Composer.
    if (inputTestId !== workbenchSelectors.input) {
      await page.keyboard.insertText(value)
      await page.waitForTimeout(100)
      return
    }
    throw new Error(
      `workbench paste event was not consumed: ${JSON.stringify(lastWorkbenchPasteDiagnostics)}`
    )
  }
  await page.waitForTimeout(100)
}

let lastWorkbenchPasteDiagnostics: unknown = null

export const setWorkbenchInput = async (
  page: Page,
  value: string,
  inputTestId = workbenchSelectors.input
): Promise<void> => {
  const input = getWorkbenchLocator(page, inputTestId)
  const selectAllInput = async (): Promise<void> => {
    await input.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('workbench input is not an HTMLElement')
      }

      const selection = window.getSelection()
      const range = document.createRange()
      element.focus()
      range.selectNodeContents(element)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
  }
  let cleared = false
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await input.click()
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    cleared = await page
      .waitForFunction(
        (testId: string) => {
          const element = document.querySelector(`[data-testid="${testId}"]`)
          if (!(element instanceof HTMLElement)) return false
          const tokenCount = element.querySelectorAll('[data-role="scope-token"]').length
          return tokenCount === 0 && !element.textContent?.trim()
        },
        inputTestId,
        { timeout: 1500 }
      )
      .then(() => true)
      .catch(() => false)
    if (cleared) break
    await selectAllInput()
    await page.keyboard.press('Backspace')
  }
  if (!cleared) throw new Error('workbench input could not be cleared through keyboard interaction')
  if (!value) return

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await input.click()
    await pasteWorkbenchText(page, value, inputTestId)
    const typed = await page
      .waitForFunction(
        (inputValue: { testId: string; expected: string }) => {
          const element = document.querySelector(`[data-testid="${inputValue.testId}"]`)
          return Boolean(element?.textContent?.includes(inputValue.expected))
        },
        {
          testId: inputTestId,
          expected: value
        },
        { timeout: 1000 }
      )
      .then(() => true)
      .catch(() => false)
    if (typed) return

    if (attempt < 3) {
      await selectAllInput()
      await page.keyboard.press('Backspace')
    }
  }

  const actual = ((await input.textContent()) || '').trim()
  throw new Error(
    `failed to type workbench input: expected "${value}", got "${actual}"; pasteDiagnostics=${JSON.stringify(lastWorkbenchPasteDiagnostics)}`
  )
}

export const appendWorkbenchInputText = async (
  page: Page,
  value: string,
  inputTestId = workbenchSelectors.input
): Promise<void> => {
  const input = getWorkbenchLocator(page, inputTestId)
  await input.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    element.focus()
    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  })
  await pasteWorkbenchText(page, value, inputTestId)
}

export const submitWorkbenchCurrentDraft = async (page: Page): Promise<void> => {
  const sendButton = getWorkbenchLocator(page, workbenchSelectors.sendButton)
  const enabled = await page
    .waitForFunction(
      (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`)
        return element instanceof HTMLButtonElement && !element.disabled
      },
      workbenchSelectors.sendButton,
      { timeout: WORKBENCH_E2E_TIMEOUT_MS }
    )
    .then(() => true)
    .catch(() => false)
  if (!enabled) {
    const state = await page.evaluate(
      (input: { inputTestId: string; sendButtonTestId: string }): WorkbenchDraftSubmitState => {
        const editor = document.querySelector(`[data-testid="${input.inputTestId}"]`)
        const send = document.querySelector(`[data-testid="${input.sendButtonTestId}"]`)
        const tokenTexts =
          editor instanceof HTMLElement
            ? Array.from(editor.querySelectorAll('[data-role="scope-token"]')).map((node) =>
                String(node.textContent || '')
                  .replace('×', '')
                  .trim()
              )
            : []
        return {
          inputText: editor?.textContent?.trim() || '',
          tokenTexts,
          sendButtonDisabled: send instanceof HTMLButtonElement ? send.disabled : null,
          sendButtonText: send?.textContent?.trim() || ''
        }
      },
      {
        inputTestId: workbenchSelectors.input,
        sendButtonTestId: workbenchSelectors.sendButton
      }
    )
    throw new Error(`workbench send button did not become enabled: ${JSON.stringify(state)}`)
  }
  await sendButton.click()
}

export const sendWorkbenchMessage = async (page: Page, value: string): Promise<void> => {
  await setWorkbenchInput(page, value)
  await submitWorkbenchCurrentDraft(page)
}

export const createWorkbenchNewSession = async (
  page: Page,
  options?: { modelName?: string }
): Promise<void> => {
  await createPartnerThroughWorkbenchUi(page, `伙伴 ${Date.now()}`)
  await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })
  // New partners persist empty UI state (mainModel: null). Re-select so send stays enabled.
  await selectWorkbenchModel(page, options?.modelName || loadWorkbenchLiveModelEnv().modelName)
}

export const selectWorkbenchAiPreference = async (
  page: Page,
  preferenceLabel: '默认' | '宽松' | '严谨'
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.aiPreferenceSwitch).click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  if (preferenceLabel === '默认') {
    await menu.getByRole('option').filter({ hasText: '默认' }).first().click()
    return
  }
  const localSourcesOption = menu.getByRole('option').filter({ hasText: '本地资料' }).first()
  await localSourcesOption.hover()
  const submenu = page.locator(
    '.workbench-select-menu[data-workbench-select-submenu-parent="local_sources"]'
  )
  await submenu.waitFor({ state: 'visible' })
  await submenu.getByRole('option').filter({ hasText: preferenceLabel }).first().click()
}

export const readWorkbenchAiPreferenceSelection = async (page: Page): Promise<string> => {
  await getWorkbenchLocator(page, workbenchSelectors.aiPreferenceSwitch).click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  const selectedDefault = menu.getByRole('option').filter({ hasText: '默认' }).first()
  if ((await selectedDefault.getAttribute('aria-selected')) === 'true') {
    await page.keyboard.press('Escape')
    return '默认'
  }
  const localSourcesOption = menu.getByRole('option').filter({ hasText: '本地资料' }).first()
  await localSourcesOption.hover()
  const submenu = page.locator(
    '.workbench-select-menu[data-workbench-select-submenu-parent="local_sources"]'
  )
  await submenu.waitFor({ state: 'visible' })
  const selectedLabel =
    (await submenu.locator('[role="option"][aria-selected="true"]').textContent()) || ''
  await page.keyboard.press('Escape')
  return selectedLabel.trim()
}

export const selectWorkbenchExecutionPermission = async (
  page: Page,
  permissionLabel: '审核' | '完全访问',
  options?: { confirmModal?: boolean; cancelModal?: boolean }
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.executionPermissionSwitch).click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  await menu.getByRole('option').filter({ hasText: permissionLabel }).first().click()
  if (permissionLabel === '完全访问') {
    if (options?.cancelModal) {
      const cancelButton = getWorkbenchLocator(
        page,
        workbenchSelectors.fullAccessConfirmCancelButton
      )
      await cancelButton.waitFor({ state: 'visible', timeout: 3000 })
      await cancelButton.click()
      await cancelButton.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
    } else if (options?.confirmModal !== false) {
      const confirmButton = getWorkbenchLocator(page, workbenchSelectors.fullAccessConfirmOkButton)
      const appeared = await confirmButton
        .waitFor({ state: 'visible', timeout: 3000 })
        .then(() => true)
        .catch(() => false)
      if (appeared) {
        await confirmButton.click()
        await confirmButton.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => undefined)
      }
    }
  }
}

export const readWorkbenchExecutionPermissionSelection = async (page: Page): Promise<string> => {
  await getWorkbenchLocator(page, workbenchSelectors.executionPermissionSwitch).click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  const selected = menu.locator('[role="option"][aria-selected="true"]').first()
  const label = ((await selected.textContent()) || '').trim()
  await page.keyboard.press('Escape')
  return label
}

export const selectWorkbenchModel = async (
  page: Page,
  modelName: string,
  selection?: { preferCustom?: boolean }
): Promise<void> => {
  const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
  await modelSelect.click()
  const menu = page.locator('.workbench-select-menu.workbench-composer-menu').last()
  await menu.waitFor({ state: 'visible' })

  if (!selection?.preferCustom) {
    const byPresetId = menu.getByTestId(
      `${workbenchSelectors.modelSelectPresetOptionPrefix}-${modelName}`
    )
    const presetReady = await byPresetId
      .waitFor({ state: 'visible', timeout: Math.min(WORKBENCH_MODEL_LIST_TIMEOUT_MS, 20_000) })
      .then(() => true)
      .catch(() => false)
    if (presetReady) {
      await byPresetId.click()
      return
    }
    const byFreeId = menu.getByTestId(
      `${workbenchSelectors.modelSelectFreeOptionPrefix}-${modelName}`
    )
    const freeReady = await byFreeId
      .waitFor({ state: 'visible', timeout: Math.min(WORKBENCH_MODEL_LIST_TIMEOUT_MS, 20_000) })
      .then(() => true)
      .catch(() => false)
    if (freeReady) {
      await byFreeId.click()
      return
    }
    const presetOptions = menu.getByRole('option')
    const presetOptionIndex = await presetOptions.evaluateAll(
      (elements, expected) =>
        elements.findIndex((element) => (element.textContent || '').trim() === expected),
      modelName
    )
    if (presetOptionIndex >= 0) {
      await presetOptions.nth(presetOptionIndex).click()
      return
    }
  }

  const customEntry = menu.locator(`[data-testid="${workbenchSelectors.modelSelectCustomEntry}"]`)
  await customEntry.waitFor({ state: 'visible' })
  await customEntry.click()

  const searchInput = menu.locator('input[placeholder="搜索模型"]')
  await searchInput.waitFor({ state: 'visible', timeout: WORKBENCH_MODEL_LIST_TIMEOUT_MS })
  await searchInput.fill(modelName)
  const modelOptions = menu.getByRole('option')
  // Remote providers can expose both `modelName` and prefixed variants such as
  // `vanchin/${modelName}`. Prefer the exact ID so the UI E2E exercises the
  // same model configured by AI_LIVE_MODEL as the backend live harness.
  const exactModelOptionIndex = await modelOptions.evaluateAll(
    (elements, expected) =>
      elements.findIndex((element) => (element.textContent || '').trim() === expected),
    modelName
  )
  if (exactModelOptionIndex < 0) {
    const optionTexts = (await modelOptions.allTextContents())
      .map((item) => item.trim())
      .filter(Boolean)
    const matchingOption = modelOptions.filter({ hasText: modelName }).last()
    if (await matchingOption.count()) {
      await matchingOption.click({ force: true })
      return
    }
    throw new Error(
      [
        `AI_LIVE_MODEL="${modelName}" was not found in the Workbench model menu.`,
        `Available models: ${optionTexts.join(', ') || '(none)'}`,
        'Workbench formal AI e2e cannot continue without a real UI-selectable live model.'
      ].join('\n')
    )
  }
  await modelOptions.nth(exactModelOptionIndex).click()
}

export const selectWorkbenchWorkspace = async (
  _page: Page,
  _workspaceName: string
): Promise<void> => {
  // Composer no longer binds a named workspace.
  void _page
  void _workspaceName
}

export const openScheduledTasksView = async (page: Page): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.scheduledTasksButton).click()
  await getWorkbenchLocator(page, scheduledTaskSelectors.view).waitFor({ state: 'visible' })
}

export const waitForScheduledTaskDrawerClosed = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => {
    const root = document.querySelector('.scheduled-task-config-drawer')
    if (!root) return true
    return (
      !root.classList.contains('ant-drawer-open') &&
      root
        .querySelector('.ant-drawer-content-wrapper')
        ?.classList.contains('ant-drawer-content-wrapper-hidden')
    )
  })
}

export const selectVisibleWorkbenchOption = async (page: Page, name: string): Promise<void> => {
  const dropdown = page.locator('.ant-select-dropdown').last()
  await dropdown.waitFor({ state: 'attached' })
  const optionLabels = await dropdown
    .locator('[role="option"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') || element.textContent || '')
    )
  const selectedIndex = await dropdown
    .locator('[role="option"]')
    .evaluateAll((elements) =>
      elements.findIndex((element) => element.getAttribute('aria-selected') === 'true')
    )
  const optionIndex = optionLabels.findIndex((label) => label.trim() === name)
  if (optionIndex < 0) {
    throw new Error(`visible Workbench option not found: ${name}`)
  }
  const optionCount = optionLabels.length
  const steps =
    selectedIndex >= 0 ? (optionIndex - selectedIndex + optionCount) % optionCount : optionIndex
  if (selectedIndex < 0) {
    await page.keyboard.press('Home')
  }
  for (let index = 0; index < steps; index += 1) {
    await page.keyboard.press('ArrowDown')
  }
  await page.keyboard.press('Enter')
}

export const selectScheduledTaskWorkspace = async (
  _page: Page,
  _workspaceName: string
): Promise<void> => {
  // Scheduled tasks no longer bind a manually selected partner/workspace.
  void _page
  void _workspaceName
}

export const fillScheduledTaskTime = async (page: Page, hhmm: string): Promise<void> => {
  const timePicker = getWorkbenchLocator(page, scheduledTaskSelectors.formTime)
  await timePicker.locator('input').click()
  await timePicker.locator('input').fill(hhmm)
  await timePicker.locator('input').press('Enter')
}

export const selectScheduledTaskPartner = async (page: Page, partnerId: string): Promise<void> => {
  const partners = (await page.evaluate(async () => await window.api.partnerList())) as PartnerListItem[]
  const partner = partners.find((item) => item.id === partnerId)
  if (!partner) throw new Error(`scheduled-task partner not found: ${partnerId}`)
  const select = getWorkbenchLocator(page, scheduledTaskSelectors.formPartner)
  await select.click()
  await select.locator('input[role="combobox"]').fill(partner.name)
  const option = getWorkbenchLocator(
    page,
    `${scheduledTaskSelectors.formPartner}-option-${partnerId}`
  )
  await option.waitFor({ state: 'visible' })
  await option.click()
}

export const waitForWorkbenchSearchScopeEmptyThroughUi = async (page: Page): Promise<string> => {
  await setWorkbenchInput(page, '@__ncurator_empty_scope_probe__')
  const panel = getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
  await panel.waitFor({ state: 'visible', timeout: WORKBENCH_E2E_TIMEOUT_MS })
  await page.waitForFunction(
    (testId: string) => {
      const text = document.querySelector(`[data-testid="${testId}"]`)?.textContent || ''
      return /没有匹配的资料|没有匹配项|No data/u.test(text)
    },
    workbenchSelectors.mentionPanel,
    { timeout: WORKBENCH_E2E_TIMEOUT_MS }
  )
  const panelText = ((await panel.textContent()) || '').trim()
  await setWorkbenchInput(page, '')
  await page.waitForTimeout(500)
  return panelText
}

const getWorkbenchMentionPanel = (page: Page, inputTestId: string): Locator =>
  inputTestId === workbenchSelectors.input
    ? getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
    : page.locator(
        `[data-testid="${scheduledTaskSelectors.formDescription}"] [data-testid="${workbenchSelectors.mentionPanel}"]`
      )

export const waitForWorkbenchMentionPanelText = async (
  page: Page,
  inputTestId = workbenchSelectors.input
): Promise<string> => {
  const panel = getWorkbenchMentionPanel(page, inputTestId)
  await panel.waitFor({ state: 'visible', timeout: WORKBENCH_E2E_TIMEOUT_MS })
  await page.waitForFunction(
    (testId: string) => {
      const text = document.querySelector(`[data-testid="${testId}"]`)?.textContent || ''
      return text.trim().length > 0 && !/^loading$/iu.test(text.trim())
    },
    workbenchSelectors.mentionPanel,
    { timeout: WORKBENCH_E2E_TIMEOUT_MS }
  )
  return ((await panel.textContent()) || '').trim()
}

export const readWorkbenchSelectedControlText = async (
  page: Page,
  testId: string
): Promise<string> =>
  (
    (await getWorkbenchLocator(page, testId)
      .evaluate((element) => {
        if (!(element instanceof HTMLElement)) return ''
        return element.title || element.getAttribute('aria-label') || element.textContent || ''
      })
      .catch(() => '')) ||
    (await getWorkbenchLocator(page, testId)
      .locator('.ant-select-selection-item')
      .textContent()
      .catch(() => '')) ||
    ''
  ).trim()

export const insertWorkbenchReferenceToken = async (
  page: Page,
  visibleName: string,
  queryText = visibleName,
  inputTestId = workbenchSelectors.input
): Promise<void> => {
  if (inputTestId === workbenchSelectors.input) {
    await appendWorkbenchInputText(page, `@${queryText}`, inputTestId)
  } else {
    const input = getWorkbenchLocator(page, inputTestId)
    await input.evaluate((element) => {
      if (!(element instanceof HTMLElement))
        throw new Error('workbench input is not an HTMLElement')
      element.focus()
      const selection = window.getSelection()
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.type(`@${queryText}`)
  }
  const panel = getWorkbenchMentionPanel(page, inputTestId)
  await waitForWorkbenchMentionPanelText(page, inputTestId)
  const option = panel.getByRole('button').filter({ hasText: visibleName }).first()
  try {
    await option.waitFor({ state: 'visible' })
  } catch (error) {
    const panelText = ((await panel.textContent().catch(() => '')) || '').trim()
    throw new Error(
      [
        `workbench reference token option not found: visibleName="${visibleName}", queryText="${queryText}"`,
        `mentionPanelText="${panelText}"`,
        error instanceof Error ? error.message : String(error)
      ].join('\n')
    )
  }
  const wrapperTestId = scheduledTaskSelectors.formDescription
  await option.click()
  await page.waitForFunction(
    (input: { testId: string; wrapperTestId: string; visibleName: string }) => {
      const editor = document.querySelector(`[data-testid="${input.testId}"]`)
      if (!(editor instanceof HTMLElement)) return false
      const tokenRoot = editor.closest(`[data-testid="${input.wrapperTestId}"]`) || editor
      return Array.from(tokenRoot.querySelectorAll('[data-role="scope-token"]')).some((node) =>
        node.textContent?.includes(input.visibleName)
      )
    },
    {
      testId: inputTestId,
      wrapperTestId,
      visibleName
    }
  )
}

export const getWorkbenchReferenceTokenTexts = async (
  page: Page,
  inputTestId = workbenchSelectors.input
): Promise<string[]> =>
  await getWorkbenchLocator(page, inputTestId).evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    const tokenRoot = element.closest('[data-testid="scheduled-task-form-description"]') || element
    return Array.from(tokenRoot.querySelectorAll('[data-role="scope-token"]')).map((node) =>
      String(node.textContent || '')
        .replace('×', '')
        .trim()
    )
  })

export const getWorkbenchLatestUserMessageReferenceTokenTexts = async (
  page: Page
): Promise<string[]> =>
  await getWorkbenchLocator(page, workbenchSelectors.userMessageReferences)
    .last()
    .evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('workbench user message references is not an HTMLElement')
      }
      return Array.from(element.querySelectorAll('[data-role="reference-inline-token"]')).map(
        (node) => String(node.textContent || '').trim()
      )
    })

export const removeFirstWorkbenchReferenceToken = async (page: Page): Promise<void> => {
  const input = getWorkbenchLocator(page, workbenchSelectors.input)
  await input.evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    const firstToken = element.querySelector('[data-role="scope-token"]')
    firstToken?.remove()
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }))
  })
}

export const waitForLatestAssistantProcess = async (page: Page): Promise<Locator> => {
  const processPrefix = `${workbenchSelectors.assistantProcessPrefix}-`
  const itemPrefix = `${workbenchSelectors.assistantProcessItemPrefix}-`
  const togglePrefix = `${workbenchSelectors.assistantProcessTogglePrefix}-`
  const locator = page
    .locator(
      `[data-testid^="${processPrefix}"]:not([data-testid^="${itemPrefix}"]):not([data-testid^="${togglePrefix}"])`
    )
    .last()
  await locator.waitFor({ state: 'visible' })
  return locator
}

export const waitForApplyEntry = async (page: Page, changeIdPart?: string): Promise<Locator> => {
  const locator = changeIdPart
    ? page.locator(
        `[data-testid*="${workbenchSelectors.assistantTurnApplyPrefix}-${changeIdPart}"]`
      )
    : getWorkbenchPrefixLocator(page, workbenchSelectors.assistantTurnApplyPrefix)
  await locator.first().waitFor({ state: 'visible' })
  return locator.first()
}

export const waitForApplyEntryByFileName = async (
  page: Page,
  fileName: string
): Promise<Locator> => {
  const locator = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.assistantTurnApplyPrefix
  ).filter({
    hasText: fileName
  })
  await locator.last().waitFor({ state: 'visible' })
  return locator.last()
}

export const waitForWorkbenchApplyPanelReady = async (page: Page): Promise<Locator> => {
  const panel = getWorkbenchLocator(page, workbenchSelectors.applyPanel)
  await panel.waitFor({ state: 'visible' })
  await page.waitForFunction(
    ({ panelTestId, docxViewerTestId, textDiffViewerTestId, revertButtonTestId }) => {
      const root = document.querySelector(`[data-testid="${panelTestId}"]`)
      if (!(root instanceof HTMLElement)) return false
      const text = root.innerText.trim()
      if (text.includes('当前没有 AI 修改记录。')) return true
      if (text.includes('当前文件暂时不可预览。')) return true
      if (text.includes('本次修改了文件名')) return true
      if (text.includes('文件已发生修改')) return true
      if (text.includes('本次删除了该文件')) return true
      if (text.includes('本次 AI 修改已回退。') || text.includes('已回退')) return true
      if (root.querySelector(`[data-testid="${revertButtonTestId}"]`)) return true
      return Boolean(
        root.querySelector(`[data-testid="${docxViewerTestId}"]`) ||
        root.querySelector(`[data-testid="${textDiffViewerTestId}"]`) ||
        root.querySelector(`[data-testid="${pptDiffViewerTestId}"]`)
      )
    },
    {
      panelTestId: workbenchSelectors.applyPanel,
      docxViewerTestId: workbenchSelectors.docxViewer,
      textDiffViewerTestId: workbenchSelectors.textDiffViewer,
      pptDiffViewerTestId: workbenchSelectors.pptDiffViewer,
      revertButtonTestId: workbenchSelectors.applyRevertButton
    },
    { timeout: WORKBENCH_LONG_E2E_TIMEOUT_MS }
  )
  return panel
}

export const waitForWorkbenchApplyRecordStatus = async (
  page: Page,
  status: 'applied' | 'reverted' | 'failed'
): Promise<Locator> => {
  const panel = getWorkbenchLocator(page, workbenchSelectors.applyPanel)
  await panel.waitFor({ state: 'visible' })
  const expectedTexts = status === 'reverted' ? ['已回退', '已删除'] : ['失败']
  await page.waitForFunction(
    ({ testId, texts, status, revertButtonTestId }) => {
      const root = document.querySelector(`[data-testid="${testId}"]`)
      if (!(root instanceof HTMLElement)) return false
      if (status === 'applied') {
        const button = root.querySelector(`[data-testid="${revertButtonTestId}"]`)
        return button instanceof HTMLButtonElement && !button.disabled
      }
      if (root.getAttribute('data-file-change-status') === status) return true
      return texts.some((text) => root.innerText.includes(text))
    },
    {
      testId: workbenchSelectors.applyPanel,
      texts: expectedTexts,
      status,
      revertButtonTestId: workbenchSelectors.applyRevertButton
    },
    { timeout: WORKBENCH_LONG_E2E_TIMEOUT_MS }
  )
  return panel
}

export const getApprovalCard = (page: Page): Locator =>
  page.locator(byTestId(chatSelectors.approvalBatchCard))

const readLocatorText = async (locator: Locator): Promise<string> =>
  ((await locator.textContent({ timeout: 500 }).catch(() => '')) || '').trim()

const readAssistantTextSoFar = async (page: Page): Promise<string> => {
  const finalAnswerText = await readLocatorText(
    getWorkbenchPrefixLocator(page, workbenchSelectors.assistantFinalAnswerPrefix).last()
  )
  if (finalAnswerText) return finalAnswerText
  return await readLocatorText(
    getWorkbenchPrefixLocator(page, workbenchSelectors.assistantThoughts).last()
  )
}

const waitForApprovalItemIndex = async (
  page: Page,
  expectedOneBasedIndex: number,
  options?: { timeoutMs?: number }
): Promise<boolean> => {
  try {
    await page.waitForFunction(
      (input: { testId: string; expectedIndex: number }) => {
        const root = document.querySelector(`[data-testid="${input.testId}"]`)
        return Boolean(root?.textContent?.includes(`审批 ${input.expectedIndex} /`))
      },
      {
        testId: chatSelectors.approvalBatchCard,
        expectedIndex: expectedOneBasedIndex
      },
      { timeout: options?.timeoutMs || WORKBENCH_E2E_TIMEOUT_MS }
    )
    return true
  } catch {
    return false
  }
}

const waitForApprovalAutoAdvance = async (
  page: Page,
  expectedOneBasedIndex: number
): Promise<void> => {
  const advanced = await waitForApprovalItemIndex(page, expectedOneBasedIndex)
  if (!advanced) {
    throw new Error(`approval card did not advance to item ${expectedOneBasedIndex}`)
  }
}

const describeWorkbenchBlockedResult = (
  blocked: WorkbenchRunBlockedResult
): { blockerType: string; summary: string; data: JsonValue } => {
  return {
    blockerType: 'approval',
    summary: `运行被审批卡住，待审命令数=${blocked.event.items.length}`,
    data: {
      batchId: blocked.event.batchId,
      taskId: blocked.event.taskId,
      items: blocked.event.items.map((item) => ({
        itemId: item.itemId,
        order: item.order,
        toolName: item.toolName,
        command: item.command,
        reason: item.reason
      })),
      assistantTextSoFar: blocked.assistantTextSoFar,
      cardText: blocked.cardText
    }
  }
}

const autoApproveWorkbenchApprovalBatch = async (
  page: Page,
  runtime: E2ETestRuntime,
  event: Extract<AiRunEvent, { type: 'approval_batch_required' }>
): Promise<void> => {
  const card = getApprovalCard(page)
  if (!(await card.isVisible().catch(() => false))) {
    await navigateToWorkbench(page)
  }
  await card.waitFor({ state: 'visible', timeout: WORKBENCH_E2E_TIMEOUT_MS })
  const totalItems = event.items.length
  for (let index = 0; index < totalItems; index += 1) {
    const cardText = await readLocatorText(card)
    runtime.signal({
      name: 'workbench-approval-auto-approve',
      message: `自动同意审批 ${index + 1}/${totalItems}`,
      data: {
        batchId: event.batchId,
        item: event.items[index] || null,
        cardText
      }
    })
    await getWorkbenchLocator(page, chatSelectors.approvalBatchApproveButton).click()
    if (index < totalItems - 1) {
      await waitForApprovalAutoAdvance(page, index + 2)
    }
  }
}

export const getAntMessageText = async (page: Page): Promise<string> => {
  return await page.evaluate(() => {
    const notices = Array.from(
      document.querySelectorAll('.ant-message .ant-message-notice-content')
    )
    const texts = notices
      .map((node) => String(node.textContent || '').trim())
      .filter((text) => text.length > 0)
    return texts.at(-1) || ''
  })
}

export const waitForAntMessageText = async (
  page: Page,
  text: string,
  timeoutMs = WORKBENCH_E2E_TIMEOUT_MS
): Promise<string> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const currentText = await getAntMessageText(page)
    if (currentText.includes(text)) return currentText
    if (Date.now() >= deadline) {
      throw new Error(
        `ant message did not include "${text}" within ${timeoutMs}ms; latest="${currentText}"`
      )
    }
    await page.waitForTimeout(100)
  }
}

export const collectWorkbenchAiRunEvents = async (
  runtime: E2ETestRuntime
): Promise<AiRunEvent[]> => {
  const signals = await runtime.collectSignals()
  return signals.aiRunEventEntries.map((entry) => entry.event)
}

export const collectWorkbenchLlmIoRecords = async (
  runtime: E2ETestRuntime
): Promise<AiLlmIoRecord[]> => {
  const signals = await runtime.collectSignals()
  return (signals.llmIoEntries || []).map((entry) => entry.record)
}

export const waitForWorkbenchAiEvent = async (
  runtime: E2ETestRuntime,
  input: {
    name: string
    timeoutMs?: number
    matches: (event: AiRunEvent) => boolean
  }
): Promise<AiRunEvent> => {
  const deadline = Date.now() + (input.timeoutMs || WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const matched = events.find(input.matches)
    if (matched) return matched
    const failed = events.find((event) => event.type === 'run_failed')
    if (failed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for ${input.name}: ${failed.message}`)
    }
    if (Date.now() >= deadline) {
      throw new Error(`AI event ${input.name} timed out`)
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500)
    })
  }
}

export const decideWorkbenchApprovalBatch = async (
  runtime: E2ETestRuntime,
  page: Page,
  input: {
    event: Extract<AiRunEvent, { type: 'approval_batch_required' }>
    action: 'approve' | 'reject'
    timeoutMs?: number
  }
): Promise<Extract<AiRunEvent, { type: 'approval_batch_decision' }>> => {
  const card = getApprovalCard(page)
  const buttonTestId =
    input.action === 'approve'
      ? chatSelectors.approvalBatchApproveButton
      : chatSelectors.approvalBatchDenyButton
  const button = getWorkbenchLocator(page, buttonTestId)
  await card.waitFor({ state: 'visible', timeout: WORKBENCH_E2E_TIMEOUT_MS })

  for (let index = 0; index < input.event.items.length; index += 1) {
    const cardText = await readLocatorText(card)
    runtime.signal({
      name: 'workbench-approval-decision-click',
      message: `提交审批决策 ${index + 1}/${input.event.items.length}`,
      data: {
        action: input.action,
        batchId: input.event.batchId,
        item: input.event.items[index] || null,
        cardText
      }
    })
    await button.waitFor({ state: 'visible', timeout: WORKBENCH_E2E_TIMEOUT_MS })
    await button.scrollIntoViewIfNeeded()
    await page.waitForFunction(
      (testId: string) => {
        const element = document.querySelector(`[data-testid="${testId}"]`)
        return element instanceof HTMLButtonElement && !element.disabled
      },
      buttonTestId,
      { timeout: WORKBENCH_E2E_TIMEOUT_MS }
    )
    await button.click()
    if (index < input.event.items.length - 1) {
      await waitForApprovalAutoAdvance(page, index + 2)
    }
  }

  const decision = await waitForWorkbenchAiEvent(runtime, {
    name: `approval_batch_decision_${input.action}_${input.event.batchId}`,
    timeoutMs: input.timeoutMs || WORKBENCH_E2E_TIMEOUT_MS,
    matches: (event) =>
      event.type === 'approval_batch_decision' &&
      event.batchId === input.event.batchId &&
      event.decisions.some((item) => item.action === input.action)
  })
  if (decision.type !== 'approval_batch_decision') {
    throw new Error(`approval batch decision did not resolve for ${input.event.batchId}`)
  }
  return decision
}

export const waitForWorkbenchAiRunOutcome = async (
  runtime: E2ETestRuntime,
  startedAtMs: number,
  modelName: string,
  options?: {
    timeoutMs?: number
    page?: Page
    blockerPolicy?: WorkbenchRunBlockerPolicy
  }
): Promise<WorkbenchAiRunOutcome> => {
  const timeoutMs = options?.timeoutMs || WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  const deadline = Date.now() + timeoutMs
  const blockerPolicy = options?.blockerPolicy || 'fail'
  const page = options?.page || runtime.page
  let approvalAutoHandledBatchIds = new Set<string>()

  for (;;) {
    const events = await collectWorkbenchAiRunEvents(runtime)
    const runStarted = events
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'run_started' }> =>
          event.type === 'run_started' && event.createdAt >= startedAtMs
      )
      .at(-1)
    if (!runStarted) {
      if (Date.now() >= deadline) {
        throw new Error(`AI run did not start within ${timeoutMs}ms`)
      }
      await page.waitForTimeout(250)
      continue
    }
    const runEvents = events.filter((event) => event.runId === runStarted.runId)
    const runFailed = runEvents.find((event) => event.type === 'run_failed')
    if (runFailed?.type === 'run_failed') {
      throw new Error(`AI run failed while waiting for completion: ${runFailed.message}`)
    }

    const runCompleted = runEvents.find((event) => event.type === 'run_completed')
    if (runCompleted?.type === 'run_completed') {
      const finalAnswerText =
        runEvents
          .filter(
            (event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
              event.type === 'answer_completed'
          )
          .map((event) => event.text)
          .at(-1) || ''
      return {
        status: 'completed',
        evidence: {
          modelName,
          durationMs: Date.now() - startedAtMs,
          events: runEvents,
          finalAnswerText
        }
      }
    }

    const approvalRequired = runEvents
      .filter(
        (event): event is Extract<AiRunEvent, { type: 'approval_batch_required' }> =>
          event.type === 'approval_batch_required'
      )
      .at(-1)
    const approvalAlreadyDecided = approvalRequired
      ? runEvents.some(
          (event) =>
            event.type === 'approval_batch_decision' && event.batchId === approvalRequired.batchId
        )
      : false
    if (
      approvalRequired &&
      !approvalAlreadyDecided &&
      !approvalAutoHandledBatchIds.has(approvalRequired.batchId)
    ) {
      const assistantTextSoFar = await readAssistantTextSoFar(page)
      const cardText = await readLocatorText(getApprovalCard(page))
      const blocked: WorkbenchRunBlockedResult = {
        kind: 'approval',
        event: approvalRequired,
        assistantTextSoFar,
        cardText
      }
      const blockedSummary = describeWorkbenchBlockedResult(blocked)
      runtime.signal({
        name: 'workbench-run-blocked',
        message: blockedSummary.summary,
        status: 'failed',
        data: {
          blockerType: blockedSummary.blockerType,
          ...(blockedSummary.data as Record<string, JsonValue>)
        }
      })
      if (blockerPolicy === 'auto_approve') {
        approvalAutoHandledBatchIds = new Set([
          ...approvalAutoHandledBatchIds,
          approvalRequired.batchId
        ])
        await autoApproveWorkbenchApprovalBatch(page, runtime, approvalRequired)
        await page.waitForTimeout(500)
        continue
      }
      return {
        status: 'blocked',
        blocked
      }
    }

    if (Date.now() >= deadline) {
      throw new Error('AI run completion timed out')
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 500)
    })
  }
}

export const waitForWorkbenchAiRunCompletion = async (
  runtime: E2ETestRuntime,
  startedAtMs: number,
  modelName: string,
  timeoutMs = WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  options?: {
    page?: Page
    blockerPolicy?: WorkbenchRunBlockerPolicy
  }
): Promise<WorkbenchAiCompletionEvidence> => {
  const outcome = await waitForWorkbenchAiRunOutcome(runtime, startedAtMs, modelName, {
    timeoutMs,
    page: options?.page,
    blockerPolicy: options?.blockerPolicy
  })
  if (outcome.status === 'blocked') {
    const blockedSummary = describeWorkbenchBlockedResult(outcome.blocked)
    throw new Error(`AI run blocked: ${blockedSummary.blockerType} - ${blockedSummary.summary}`)
  }
  return outcome.evidence
}

export const recordWorkbenchAiEvidence = (
  runtime: E2ETestRuntime,
  evidence: WorkbenchAiCompletionEvidence,
  completionScore: number,
  failureAttribution = ''
): void => {
  const eventTypeCounts = evidence.events.reduce<Record<string, number>>((counts, event) => {
    counts[event.type] = (counts[event.type] || 0) + 1
    return counts
  }, {})
  const toolCallResultCount = evidence.events.filter(
    (event): event is Extract<AiRunEvent, { type: 'tool_call_result' }> =>
      event.type === 'tool_call_result'
  ).length
  const fileArtifactCount = evidence.events.filter(
    (event): event is Extract<AiRunEvent, { type: 'file_artifact' }> =>
      event.type === 'file_artifact'
  ).length
  const toolNames = Array.from(
    new Set(
      evidence.events
        .filter(
          (
            event
          ): event is Extract<AiRunEvent, { type: 'tool_call_started' | 'tool_call_result' }> =>
            event.type === 'tool_call_started' || event.type === 'tool_call_result'
        )
        .map((event) => event.toolName)
    )
  )
  runtime.signal({
    name: 'workbench-ai-evidence',
    message: '记录 Workbench 真实 AI e2e 模型、耗时、完成度评分与失败归因。',
    data: {
      modelName: evidence.modelName,
      durationMs: evidence.durationMs,
      completionScore,
      failureAttribution,
      eventTypeCounts,
      toolCallResultCount,
      fileArtifactCount,
      finalAnswerLength: evidence.finalAnswerText.trim().length,
      toolNames
    }
  })
}

export const waitForLatestAssistantFinalAnswerText = async (
  page: Page,
  timeoutMs = WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
): Promise<string> => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const locator = getWorkbenchPrefixLocator(
      page,
      workbenchSelectors.assistantFinalAnswerPrefix
    ).last()
    const text = ((await locator.textContent().catch(() => '')) || '').trim()
    if (text) return text
    if (Date.now() >= deadline) {
      throw new Error('latest assistant final answer timed out')
    }
    await page.waitForTimeout(500)
  }
}

export const assertWorkbenchLocalSearchResultsPanelHidden = async (page: Page): Promise<void> => {
  const results = getWorkbenchLocator(page, workbenchSelectors.searchResults)
  const count = await results.count()
  if (count === 0) return
  const visible = await results.isVisible().catch(() => false)
  if (!visible) return
  throw new Error('Composer search results panel should stay hidden during web_search AI runs')
}

export const assertNoWorkbenchFakeSignals = async (
  runtime: E2ETestRuntime,
  signals?: E2ERuntimeSignals
): Promise<void> => {
  const currentSignals = signals || (await runtime.collectSignals())
  const forbiddenPattern = /\[e2e:|fake search|fake docx|fake ai event|fake browser|E2EFixture/u
  const ipcText = JSON.stringify(currentSignals.ipcInvokeEntries)
  const consoleText = JSON.stringify(currentSignals.consoleEntries)
  const aiText = JSON.stringify(
    currentSignals.aiRunEventEntries.map((entry) => ({
      type: entry.event.type
    }))
  )
  await runtime.assertThat(
    !forbiddenPattern.test(ipcText) &&
      !forbiddenPattern.test(consoleText) &&
      !forbiddenPattern.test(aiText),
    {
      name: 'workbench-no-fake-e2e-signal',
      message:
        'Workbench formal e2e 日志中不应出现 [e2e:*]、fake search、fake docx、fake AI event 或 fake browser 痕迹。',
      data: {
        ipcCallCount: currentSignals.ipcInvokeEntries.length,
        aiEventCount: currentSignals.aiRunEventEntries.length,
        consoleCount: currentSignals.consoleEntries.length
      }
    }
  )
}

export const mutateDocxExternally = async (filePath: string, marker: string): Promise<void> => {
  const zip = await JSZip.loadAsync(await readFile(filePath))
  zip.file(
    'customXml/ncurator-e2e-external-mutation.xml',
    `<ncurator-e2e-marker>${marker}</ncurator-e2e-marker>`
  )
  const nextBytes = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
  await writeFile(filePath, nextBytes)
}

export const readDocxPlainText = async (filePath: string): Promise<string> => {
  const bundle = await loadDocxBundle(await readFile(filePath))
  return buildDocumentNodeIndex(bundle)
    .outline.filter((node) => node.type !== 'table_cell')
    .map((node) => node.text)
    .join('\n')
}

export const readXlsxPlainText = async (filePath: string): Promise<string> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load((await readFile(filePath)) as never)
  const chunks: string[] = []
  workbook.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        const text = String(cell.text || cell.value || '').trim()
        if (text) chunks.push(text)
      })
    })
  })
  return chunks.join('\n')
}

export const readPptxPlainText = async (filePath: string): Promise<string> => {
  const presentation = await loadPresentation(new Uint8Array(await readFile(filePath)))
  return getSlides(presentation)
    .map((slide) => getSlideText(slide).trim())
    .filter(Boolean)
    .join('\n')
}

export const readOfficePlainText = async (filePath: string): Promise<string> => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.docx') return readDocxPlainText(filePath)
  if (extension === '.xlsx') return readXlsxPlainText(filePath)
  if (extension === '.pptx') return readPptxPlainText(filePath)
  throw new Error(`unsupported office text path: ${filePath}`)
}
