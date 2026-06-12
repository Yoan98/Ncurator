import type { Locator, Page } from 'playwright'
import type { LLMConfig, WorkspaceMutationResponse } from '../../../src/shared/types'
import {
  chatSelectors,
  settingsSelectors,
  workbenchSelectors
} from '../../../src/renderer/src/testing/selectors'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  seedModelConfigs,
  setSettingsE2EApiOverrides,
  waitForFileIndexJobIdle
} from './settings'

export const WORKBENCH_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS
export const WORKBENCH_LONG_E2E_TIMEOUT_MS = 60_000

export const WORKBENCH_FIXTURE_MODEL_CONFIG: LLMConfig = {
  id: 'workbench-e2e-model-config',
  providerKind: 'openai-compatible',
  base_url: 'https://example.test/v1',
  api_key: 'sk-workbench-e2e',
  is_active: true,
  default_model: 'workbench-e2e-model'
}

export const WORKBENCH_FIXTURE_MODEL_LIST = {
  success: true,
  items: [
    {
      id: 'workbench-e2e-model',
      label: 'Workbench E2E Model'
    },
    {
      id: 'workbench-e2e-model-alt',
      label: 'Workbench E2E Model Alt'
    }
  ]
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

export const getWorkbenchLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getWorkbenchPrefixLocator = (page: Page, testIdPrefix: string): Locator =>
  page.locator(byTestIdPrefix(testIdPrefix))

export const navigateToWorkbench = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await getWorkbenchLocator(page, workbenchSelectors.page).waitFor({ state: 'visible' })
  await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })
}

export const seedWorkbenchModelConfig = async (page: Page): Promise<void> => {
  await seedModelConfigs(page, [WORKBENCH_FIXTURE_MODEL_CONFIG])
  await setSettingsE2EApiOverrides(page, {
    llmModelListResponseByConfigId: {
      [WORKBENCH_FIXTURE_MODEL_CONFIG.id]: WORKBENCH_FIXTURE_MODEL_LIST
    }
  })
  await page.evaluate(() => {
    window.dispatchEvent(new Event('check-llm-config'))
  })
}

export const createWorkbenchWorkspace = async (
  page: Page,
  input?: { name?: string; rootPath?: string; prepare?: boolean }
): Promise<WorkspaceMutationResponse> => {
  const response = await createFixtureWorkspace(page, {
    name: input?.name || 'Workbench E2E 工作区',
    rootPath: input?.rootPath ?? '/tmp/ncurator-workbench-e2e-workspace'
  })
  if (input?.prepare) {
    const prepareResponse = await page.evaluate(async (workspaceId) => {
      return await window.api.workspacePrepare({ workspaceId })
    }, response.workspace!.id)
    if (!prepareResponse.success) {
      throw new Error(prepareResponse.error || 'failed to prepare workbench workspace')
    }
    await waitForFileIndexJobIdle(page, response.workspace!.id, WORKBENCH_LONG_E2E_TIMEOUT_MS)
  }
  return response
}

export const seedWorkbenchReadyState = async (
  page: Page,
  input?: { prepareWorkspace?: boolean; rootPath?: string }
): Promise<WorkspaceMutationResponse> => {
  await seedWorkbenchModelConfig(page)
  const workspaceResponse = await createWorkbenchWorkspace(page, {
    rootPath: input?.rootPath,
    prepare: input?.prepareWorkspace
  })
  await page.evaluate(() => {
    window.localStorage.setItem('workbench.preference.mode', 'ai')
    window.location.hash = '#/settings/model'
  })
  await getSettingsLocator(page, settingsSelectors.page).waitFor({ state: 'visible' })
  await navigateToWorkbench(page)
  await getWorkbenchLocator(page, workbenchSelectors.modelSelect).waitFor({ state: 'visible' })
  await getWorkbenchLocator(page, workbenchSelectors.workspaceSelect).waitFor({ state: 'visible' })
  return workspaceResponse
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
  const locator = getWorkbenchPrefixLocator(page, workbenchSelectors.assistantFinalAnswerPrefix).last()
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
    ? page.locator(`[data-testid*="${workbenchSelectors.assistantTurnApplyPrefix}-${changeIdPart}"]`)
    : getWorkbenchPrefixLocator(page, workbenchSelectors.assistantTurnApplyPrefix)
  await locator.first().waitFor({ state: 'visible' })
  return locator.first()
}

export const getApprovalCard = (page: Page): Locator =>
  getSettingsLocator(page, chatSelectors.approvalBatchCard)

export const getWorkspaceRequiredCard = (page: Page): Locator =>
  getSettingsLocator(page, chatSelectors.workspaceBanner)

export const getAntMessageText = async (page: Page): Promise<string> => {
  const messages = page.locator('.ant-message')
  const count = await messages.count()
  if (count === 0) return ''
  return (await messages.nth(count - 1).textContent({ timeout: 500 })) || ''
}
