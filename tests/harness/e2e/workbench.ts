import type { Locator, Page } from 'playwright'
import { workbenchSelectors } from '../../../src/renderer/src/testing/selectors'

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

export const getWorkbenchLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getWorkbenchAssistantStepButtons = (page: Page): Locator =>
  page.locator(`button${byTestIdPrefix(workbenchSelectors.assistantTurnStepsPrefix)}`)

export const getWorkbenchAssistantApplyButtons = (page: Page): Locator =>
  page.locator(`button${byTestIdPrefix(workbenchSelectors.assistantTurnApplyPrefix)}`)

export const waitForWorkbenchReady = async (page: Page): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.input).waitFor({ state: 'visible' })
}

export const switchWorkbenchMode = async (
  page: Page,
  mode: 'ai' | 'search'
): Promise<void> => {
  await getWorkbenchLocator(page, workbenchSelectors.modeSwitch).click()
  const optionName = mode === 'ai' ? '大聪明' : '没头脑'
  const dropdownOption = page
    .locator('.ant-select-dropdown .ant-select-item-option')
    .filter({ hasText: optionName })
    .first()
  await dropdownOption.waitFor({ state: 'visible' })
  await dropdownOption.click()
}

export const submitWorkbenchMessage = async (page: Page, input: string): Promise<void> => {
  const editor = getWorkbenchLocator(page, workbenchSelectors.input)
  await editor.click()
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
  await page.keyboard.press('Backspace')
  await page.keyboard.type(input)
  await getWorkbenchLocator(page, workbenchSelectors.sendButton).click()
}

export const waitForAssistantTurnCount = async (page: Page, count: number): Promise<void> => {
  await page.waitForFunction(
    ({ selector, minCount }) => document.querySelectorAll(selector).length >= minCount,
    {
      selector: `button${byTestIdPrefix(workbenchSelectors.assistantTurnStepsPrefix)}`,
      minCount: count
    }
  )
}

export const waitForApplyTabCount = async (page: Page, count: number): Promise<void> => {
  await page.waitForFunction(
    ({ selector, minCount }) => {
      const host = document.querySelector(selector)
      if (!(host instanceof HTMLElement)) return false
      return Array.from(host.querySelectorAll('button')).filter(
        (button) => button instanceof HTMLElement && button.offsetParent !== null
      ).length >= minCount
    },
    {
      selector: byTestId(workbenchSelectors.applyTabs),
      minCount: count
    }
  )
}

export const expandLatestAssistantTurn = async (page: Page): Promise<void> => {
  await getWorkbenchAssistantStepButtons(page).last().click()
}

export const openLatestAssistantApply = async (page: Page): Promise<void> => {
  const applyButtons = getWorkbenchAssistantApplyButtons(page)
  if ((await applyButtons.count()) === 0) {
    await expandLatestAssistantTurn(page)
  }
  await page.waitForFunction(
    ({ selector }) =>
      Array.from(document.querySelectorAll(selector)).some(
        (button) => button instanceof HTMLElement && button.offsetParent !== null
      ),
    {
      selector: `button${byTestIdPrefix(workbenchSelectors.assistantTurnApplyPrefix)}`
    }
  )
  await applyButtons.last().click()
}

export const openFirstEditedFileChipFromExpandedTurn = async (page: Page): Promise<void> => {
  const editedSectionTitle = page.getByText('修改的文件').last()
  await editedSectionTitle.waitFor({ state: 'visible' })
  const editedFileButtons = editedSectionTitle.locator('xpath=..').locator('button')
  await editedFileButtons.first().click()
}
