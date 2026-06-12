import type { Locator, Page } from 'playwright'
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

export const WORKBENCH_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS
export const WORKBENCH_LONG_E2E_TIMEOUT_MS = SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
export const WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS = 900_000
export const WORKBENCH_MODEL_LIST_TIMEOUT_MS = 60_000

export type WorkbenchLiveModelEnv = {
  baseUrl: string
  apiKey: string
  modelName: string
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

const readEnv = (name: string): string => {
  loadRootEnvOnce()
  return String(process.env[name] || '').trim()
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
  await getWorkbenchLocator(page, workbenchSelectors.modelSelect).click()
  const modelOption = page
    .locator('.workbench-composer-select-dropdown:not(.ant-select-dropdown-hidden)')
    .locator('.ant-select-item-option')
    .filter({ hasText: env.modelName })
    .first()
  await modelOption.waitFor({
    state: 'visible',
    timeout: WORKBENCH_MODEL_LIST_TIMEOUT_MS
  })
  await modelOption.click()
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

export const addWebSourceThroughSettingsUi = async (page: Page, url: string): Promise<void> => {
  await navigateToSettingsSection(page, 'workspace')
  await page.getByRole('tab', { name: /网页/u }).click()
  await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).click()
  await getSettingsLocator(page, importSelectors.webSourceUrlInput).fill(url)
  await getSettingsLocator(page, importSelectors.webSourceConfirmButton).click()
  await getSettingsLocator(page, importSelectors.webSourceModal).waitFor({ state: 'hidden' })
  await getSettingsLocator(page, importSelectors.webSourceList).getByText(url).waitFor({
    state: 'visible'
  })
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

    const selection = window.getSelection()
    const range = document.createRange()
    element.focus()
    range.selectNodeContents(element)
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
