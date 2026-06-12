import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import JSZip from 'jszip'
import type { Locator, Page } from 'playwright'
import type { AiRunEvent } from '../../../src/shared/types'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import {
  chatSelectors,
  importSelectors,
  settingsSelectors,
  workbenchSelectors
} from '../../../src/renderer/src/testing/selectors'
import { loadRootEnvOnce } from '../core/rootEnv'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection
} from './settings'
import type { E2ETestRuntime } from './run-e2e-case'
import type { E2ERuntimeSignals } from './electronApp'

export const WORKBENCH_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS
export const WORKBENCH_LONG_E2E_TIMEOUT_MS = SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
export const WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS = 900_000
export const WORKBENCH_MODEL_LIST_TIMEOUT_MS = 60_000
export const WORKBENCH_FIXTURE_ROOT = 'tests/fixtures/workspace'

export type WorkbenchLiveModelEnv = {
  baseUrl: string
  apiKey: string
  modelName: string
}

export type TemporaryWorkbenchWorkspace = {
  rootPath: string
  cleanup: () => Promise<void>
}

export type LocalWorkbenchHttpServer = {
  url: string
  close: () => Promise<void>
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

export {
  chatSelectors,
  importSelectors,
  settingsSelectors,
  workbenchSelectors
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`
const execFileAsync = promisify(execFile)

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
}

const sanitizeCasePathPart = (caseId: string): string =>
  caseId.replace(/[^a-zA-Z0-9-_]/g, '-')

const closeServer = async (server: Server): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

const waitForCondition = async (
  input: {
    name: string
    timeoutMs: number
    intervalMs?: number
    check: () => Promise<boolean>
  }
): Promise<void> => {
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
  const baseUrl = readEnv('AI_LIVE_BASE_URL')
  const apiKey = readEnv('AI_LIVE_API_KEY')
  const modelName = readEnv('AI_LIVE_PRIMARY_MODEL_NAME')

  if (!baseUrl || !apiKey || !modelName) {
    throw new Error(
      [
        'Workbench formal AI e2e 缺少真实模型配置，必须设置：',
        '- AI_LIVE_BASE_URL',
        '- AI_LIVE_API_KEY',
        '- AI_LIVE_PRIMARY_MODEL_NAME'
      ].join('\n')
    )
  }

  return {
    baseUrl,
    apiKey,
    modelName
  }
}

export const createTemporaryWorkbenchWorkspace = async (
  caseId: string
): Promise<TemporaryWorkbenchWorkspace> => {
  const rootPath = await mkdtemp(
    path.join(os.tmpdir(), `ncurator-workbench-${sanitizeCasePathPart(caseId)}-`)
  )
  await cp(path.resolve(WORKBENCH_FIXTURE_ROOT), rootPath, {
    recursive: true,
    force: true
  })

  return {
    rootPath,
    cleanup: async () => {
      await rm(rootPath, {
        recursive: true,
        force: true
      })
    }
  }
}

export const startLocalWorkbenchHttpServer = async (
  html: string
): Promise<LocalWorkbenchHttpServer> => {
  const server = createServer((request, response) => {
    const requestUrl = request.url || '/'
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

export const navigateToWorkbench = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await getWorkbenchLocator(page, workbenchSelectors.page).waitFor({ state: 'visible' })
  await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })
}

export const configureLiveModelThroughSettingsUi = async (
  page: Page,
  env: WorkbenchLiveModelEnv = loadWorkbenchLiveModelEnv()
): Promise<void> => {
  await navigateToSettingsSection(page, 'model')
  await getSettingsLocator(page, settingsSelectors.modelAddButton).click()
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput).waitFor({
    state: 'visible'
  })
  await getSettingsLocator(page, settingsSelectors.modelBaseUrlInput)
    .locator('input')
    .fill(env.baseUrl)
  await getSettingsLocator(page, settingsSelectors.modelApiKeyInput).fill(env.apiKey)
  await getSettingsLocator(page, settingsSelectors.modelSaveButton).click()
  await getSettingsLocator(page, settingsSelectors.modelSummaryCurrent).waitFor({
    state: 'visible'
  })

  await navigateToWorkbench(page)
  await selectWorkbenchModel(page, env.modelName)
}

export const createWorkspaceThroughSettingsUi = async (
  page: Page,
  workspaceName: string
): Promise<void> => {
  await navigateToSettingsSection(page, 'workspace')
  await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
  await getSettingsLocator(page, importSelectors.createWorkspaceNameInput).fill(workspaceName)
  await getSettingsLocator(page, importSelectors.createWorkspaceConfirmButton).click()
  await getSettingsLocator(page, importSelectors.workspaceDetail)
    .getByRole('heading', { name: workspaceName })
    .waitFor({ state: 'visible' })
}

type WorkbenchE2EWindow = Window & {
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
}

const readElectronProcessId = async (page: Page): Promise<number | null> =>
  page.evaluate(() => {
    const currentWindow = window as WorkbenchE2EWindow
    return currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ || null
  })

export const selectDirectoryInNativeDialog = async (
  directoryPath: string,
  electronProcessId: number | null
): Promise<void> => {
  if (process.platform !== 'darwin') {
    throw new Error('native directory dialog automation currently supports macOS only')
  }

  const script = [
    'on run argv',
    '  set targetPath to item 1 of argv',
    '  set targetPid to item 2 of argv',
    '  tell application "System Events"',
    '    set targetProcess to missing value',
    '    if targetPid is not "" then',
    '      set numericPid to targetPid as integer',
    '      repeat 80 times',
    '        set matches to every process whose unix id is numericPid',
    '        if (count of matches) > 0 then',
    '          set targetProcess to item 1 of matches',
    '          exit repeat',
    '        end if',
    '        delay 0.1',
    '      end repeat',
    '    end if',
    '    if targetProcess is missing value then',
    '      set targetProcess to first process whose frontmost is true',
    '    end if',
    '    tell targetProcess',
    '      set frontmost to true',
    '      delay 0.5',
    '      set the clipboard to targetPath',
    '      keystroke "g" using {command down, shift down}',
    '      delay 0.8',
    '      keystroke "v" using {command down}',
    '      delay 0.2',
    '      key code 36',
    '      delay 1.0',
    '      key code 36',
    '      delay 0.5',
    '    end tell',
    '  end tell',
    'end run'
  ].join('\n')

  await execFileAsync(
    '/usr/bin/osascript',
    ['-e', script, directoryPath, electronProcessId ? String(electronProcessId) : ''],
    {
      timeout: 30_000
    }
  )
}

export const bindWorkspaceRootThroughSettingsUi = async (
  page: Page,
  rootPath: string
): Promise<void> => {
  const rootPathButton = page.getByRole('button', { name: '设置工作文件地址' }).first()
  await page.bringToFront()
  await rootPathButton.waitFor({ state: 'visible' })

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const electronProcessId = await readElectronProcessId(page)
    await rootPathButton.evaluate((element) => {
      if (element instanceof HTMLElement) element.click()
    })
    await page.waitForTimeout(1500)
    await selectDirectoryInNativeDialog(rootPath, electronProcessId)
    const selected = await page
      .waitForFunction(
        (input: { testId: string; rootPath: string }) => {
          const detail = document.querySelector(`[data-testid="${input.testId}"]`)
          return detail instanceof HTMLElement && detail.innerText.includes(input.rootPath)
        },
        {
          testId: importSelectors.workspaceDetail,
          rootPath
        },
        { timeout: 10_000 }
      )
      .then(() => true)
      .catch(() => false)
    if (selected) return
  }

  throw new Error(`failed to select workspace root path through native dialog: ${rootPath}`)
}

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

export const prepareSelectedWorkspaceFilesThroughSettingsUi = async (
  page: Page
): Promise<void> => {
  const prepareButton = getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton)
  await prepareButton.waitFor({ state: 'visible' })
  await waitForCondition({
    name: 'workspace files actionable count ready',
    timeoutMs: WORKBENCH_E2E_TIMEOUT_MS,
    check: async () => {
      const text =
        (await getSettingsLocator(page, importSelectors.workspaceActionableIndexCount)
          .textContent()
          .catch(() => '')) || ''
      return Number(text.trim() || 0) >= 0
    }
  })
  const actionableText =
    (await getSettingsLocator(page, importSelectors.workspaceActionableIndexCount).textContent()) ||
    '0'
  if (Number(actionableText.trim() || 0) === 0) return
  await prepareButton.click()
  await waitForSettingsCountToBecome(
    page,
    importSelectors.workspaceActionableIndexCount,
    0,
    WORKBENCH_LONG_E2E_TIMEOUT_MS
  )
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
  await createWorkspaceThroughSettingsUi(page, input.workspaceName)
  await bindWorkspaceRootThroughSettingsUi(page, input.rootPath)
  await prepareSelectedWorkspaceFilesThroughSettingsUi(page)
  if (input.webSourceUrl) {
    await addWebSourceThroughSettingsUi(page, input.webSourceUrl)
    await prepareSelectedWorkspaceWebSourcesThroughSettingsUi(page)
  }
  await navigateToWorkbench(page)
  await selectWorkbenchWorkspace(page, input.workspaceName)
}

export const setupWorkbenchWithTempWorkspace = async (
  page: Page,
  input: {
    caseId: string
    workspaceName?: string
    webSourceUrl?: string
    configureModel?: boolean
  }
): Promise<WorkbenchSetupResult> => {
  const env = loadWorkbenchLiveModelEnv()
  const workspace = await createTemporaryWorkbenchWorkspace(input.caseId)
  const workspaceName = input.workspaceName || `Workbench ${input.caseId}`
  if (input.configureModel !== false) {
    await configureLiveModelThroughSettingsUi(page, env)
  }
  await prepareWorkbenchWorkspaceThroughUi(page, {
    workspaceName,
    rootPath: workspace.rootPath,
    webSourceUrl: input.webSourceUrl
  })
  if (input.configureModel !== false) {
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
  const workspaceName = input.workspaceName || `Workbench ${input.caseId}`
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

export const setWorkbenchInput = async (page: Page, value: string): Promise<void> => {
  const input = getWorkbenchLocator(page, workbenchSelectors.input)
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
  const pasteText = async (text: string): Promise<void> => {
    await input.evaluate((element, textToPaste) => {
      if (!(element instanceof HTMLElement)) {
        throw new Error('workbench input is not an HTMLElement')
      }
      element.focus()
      const dataTransfer = new DataTransfer()
      dataTransfer.setData('text/plain', textToPaste)
      const event = new ClipboardEvent('paste', {
        bubbles: true,
        cancelable: true,
        clipboardData: dataTransfer
      })
      element.dispatchEvent(event)
    }, text)
  }

  await selectAllInput()
  await page.keyboard.press('Backspace')
  if (!value) return

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await pasteText(value)
    const typed = await page
      .waitForFunction(
        (inputValue: { testId: string; expected: string }) => {
          const element = document.querySelector(`[data-testid="${inputValue.testId}"]`)
          return Boolean(element?.textContent?.includes(inputValue.expected))
        },
        {
          testId: workbenchSelectors.input,
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
  throw new Error(`failed to type workbench input: expected "${value}", got "${actual}"`)
}

export const appendWorkbenchInputText = async (page: Page, value: string): Promise<void> => {
  const input = getWorkbenchLocator(page, workbenchSelectors.input)
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
  await input.evaluate((element, textToPaste) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    element.focus()
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/plain', textToPaste)
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer
    })
    element.dispatchEvent(event)
  }, value)
}

export const sendWorkbenchMessage = async (page: Page, value: string): Promise<void> => {
  await setWorkbenchInput(page, value)
  await page.waitForFunction((testId: string) => {
    const element = document.querySelector(`[data-testid="${testId}"]`)
    return element instanceof HTMLButtonElement && !element.disabled
  }, workbenchSelectors.sendButton)
  await getWorkbenchLocator(page, workbenchSelectors.sendButton).evaluate((element) => {
    if (element instanceof HTMLElement) element.click()
  })
}

export const switchWorkbenchMode = async (
  page: Page,
  modeLabel: '大聪明' | '没头脑'
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.modeSwitch).click()
  const option = page
    .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
    .getByText(modeLabel)
  await option.waitFor({ state: 'visible' })
  await option.evaluate((element) => {
    if (element instanceof HTMLElement) element.click()
  })
}

export const selectWorkbenchModel = async (page: Page, modelName: string): Promise<void> => {
  const modelSelect = getWorkbenchLocator(page, workbenchSelectors.modelSelect)
  await modelSelect.click()
  await modelSelect.locator('input').fill(modelName)
  const dropdown = page
    .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
  const options = dropdown.locator('.ant-select-item-option')
  const modelOption = options.filter({ hasText: modelName }).first()
  await dropdown.waitFor({ state: 'visible' })
  try {
    await modelOption.waitFor({
      state: 'visible',
      timeout: WORKBENCH_MODEL_LIST_TIMEOUT_MS
    })
  } catch {
    const optionTexts = (await options.allTextContents()).map((item) => item.trim()).filter(Boolean)
    throw new Error(
      [
        `AI_LIVE_PRIMARY_MODEL_NAME="${modelName}" was not found in the Workbench model dropdown.`,
        `Available models: ${optionTexts.join(', ') || '(none)'}`,
        'Workbench formal AI e2e cannot continue without a real UI-selectable live model.'
      ].join('\n')
    )
  }
  await modelOption.click()
}

export const selectWorkbenchWorkspace = async (
  page: Page,
  workspaceName: string
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.workspaceSelect).click()
  const workspaceOption = page
    .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
    .last()
    .locator('.ant-select-item-option')
    .filter({ hasText: workspaceName })
    .first()
  await workspaceOption.waitFor({ state: 'visible' })
  await workspaceOption.click()
}

export const readWorkbenchSelectedControlText = async (
  page: Page,
  testId: string
): Promise<string> =>
  (
    (await getWorkbenchLocator(page, testId)
      .locator('.ant-select-selection-item')
      .textContent()
      .catch(() => '')) || ''
  ).trim()

export const insertWorkbenchReferenceToken = async (
  page: Page,
  visibleName: string
): Promise<void> => {
  await appendWorkbenchInputText(page, '@')
  const panel = getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
  await panel.waitFor({ state: 'visible' })
  const option = panel.getByText(visibleName, { exact: false }).first()
  await option.waitFor({ state: 'visible' })
  await option.click()
  await page.waitForFunction(
    (input: { testId: string; visibleName: string }) => {
      const editor = document.querySelector(`[data-testid="${input.testId}"]`)
      if (!(editor instanceof HTMLElement)) return false
      return Array.from(editor.querySelectorAll('[data-role="scope-token"]')).some((node) =>
        node.textContent?.includes(input.visibleName)
      )
    },
    {
      testId: workbenchSelectors.input,
      visibleName
    }
  )
}

export const getWorkbenchReferenceTokenTexts = async (page: Page): Promise<string[]> =>
  await getWorkbenchLocator(page, workbenchSelectors.input).evaluate((element) => {
    if (!(element instanceof HTMLElement)) {
      throw new Error('workbench input is not an HTMLElement')
    }
    return Array.from(element.querySelectorAll('[data-role="scope-token"]')).map((node) =>
      String(node.textContent || '').replace('×', '').trim()
    )
  })

export const removeFirstWorkbenchReferenceToken = async (page: Page): Promise<void> => {
  const removeButton = getWorkbenchLocator(page, workbenchSelectors.input)
    .locator('[data-action="remove-scope-token"]')
    .first()
  await removeButton.waitFor({ state: 'visible' })
  await removeButton.click()
}

export const waitForLatestAssistantFinalAnswer = async (page: Page): Promise<Locator> => {
  const locator = getWorkbenchPrefixLocator(
    page,
    workbenchSelectors.assistantFinalAnswerPrefix
  ).last()
  await locator.waitFor({ state: 'visible' })
  return locator
}

export const waitForLatestAssistantProcess = async (page: Page): Promise<Locator> => {
  const locator = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantProcessPrefix).last()
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

export const getApprovalCard = (page: Page): Locator =>
  page.locator(byTestId(chatSelectors.approvalBatchCard))

export const getWorkspaceRequiredCard = (page: Page): Locator =>
  page.locator(byTestId(chatSelectors.workspaceBanner))

export const getAntMessageText = async (page: Page): Promise<string> => {
  const messages = page.locator('.ant-message')
  if (!(await messages.count())) return ''
  return ((await messages.last().textContent()) || '').trim()
}

export const collectWorkbenchAiRunEvents = async (
  runtime: E2ETestRuntime
): Promise<AiRunEvent[]> => {
  const signals = await runtime.collectSignals()
  return signals.aiRunEventEntries.map((entry) => entry.event)
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
      throw new Error(`AI run failed while waiting for ${input.name}: ${failed.error}`)
    }
    if (Date.now() >= deadline) {
      throw new Error(`AI event ${input.name} timed out`)
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
  timeoutMs = WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
): Promise<WorkbenchAiCompletionEvidence> => {
  await waitForWorkbenchAiEvent(runtime, {
    name: 'run_completed',
    timeoutMs,
    matches: (event) => event.type === 'run_completed'
  })
  const events = await collectWorkbenchAiRunEvents(runtime)
  const finalAnswerText = events
    .filter((event): event is Extract<AiRunEvent, { type: 'answer_completed' }> =>
      event.type === 'answer_completed'
    )
    .map((event) => event.text)
    .at(-1) || ''
  return {
    modelName,
    durationMs: Date.now() - startedAtMs,
    events,
    finalAnswerText
  }
}

export const recordWorkbenchAiEvidence = (
  runtime: E2ETestRuntime,
  evidence: WorkbenchAiCompletionEvidence,
  completionScore: number,
  failureAttribution = ''
): void => {
  runtime.signal({
    name: 'workbench-ai-evidence',
    message: '记录 Workbench 真实 AI e2e 模型、耗时、完成度评分与失败归因。',
    data: {
      modelName: evidence.modelName,
      durationMs: evidence.durationMs,
      completionScore,
      failureAttribution
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

export const waitForWorkbenchSearchResults = async (page: Page): Promise<Locator> => {
  const results = getWorkbenchLocator(page, workbenchSelectors.searchResults)
  await results.waitFor({ state: 'visible', timeout: WORKBENCH_LONG_E2E_TIMEOUT_MS })
  await page.waitForFunction(
    (testId: string) => {
      const host = document.querySelector(`[data-testid="${testId}"]`)
      return Boolean(host?.textContent?.trim())
    },
    workbenchSelectors.searchResults,
    { timeout: WORKBENCH_E2E_TIMEOUT_MS }
  )
  return results
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

export const mutateDocxExternally = async (
  filePath: string,
  marker: string
): Promise<void> => {
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
  return buildBlockIndex(bundle.documentDom).outline
    .filter((block) => block.type !== 'table_cell')
    .map((block) => block.text)
    .join('\n')
}
