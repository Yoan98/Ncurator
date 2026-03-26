import type { Page } from 'playwright'
import { workbenchSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { openWorkbench } from '../../../../workspace/e2e/utils/workspaceUi'

const waitForWorkbenchInputReady = async (page: Page): Promise<void> => {
  await page.getByTestId(workbenchSelectors.input).click()
  await page.getByTestId(workbenchSelectors.input).focus()
  await page.waitForFunction((testId) => {
    const editorElement = document.querySelector(`[data-testid="${testId}"]`)
    if (!(editorElement instanceof HTMLElement)) return false
    const selection = window.getSelection()
    return (
      document.activeElement === editorElement &&
      Boolean(selection?.anchorNode) &&
      editorElement.contains(selection.anchorNode)
    )
  }, workbenchSelectors.input)
}

const resetWorkbenchSessions = async (page: Page): Promise<void> => {
  await openWorkbench(page)
  await page.evaluate(async () => {
    const sessions = await window.api.chatSessionList()
    for (const session of sessions) {
      await window.api.chatSessionDelete(session.id)
    }
  })
  await page.reload()
  await openWorkbench(page)
}

export const submitWorkbenchAiMessage = async (page: Page, input: string): Promise<void> => {
  await resetWorkbenchSessions(page)
  await waitForWorkbenchInputReady(page)
  await page.keyboard.type(input)
  await page.getByTestId(workbenchSelectors.sendButton).click()
}

export const expandLatestAssistantTurn = async (page: Page): Promise<void> => {
  const reviewTargets = page.locator(
    `[data-testid^="${workbenchSelectors.assistantTurnReviewPrefix}-"]`
  )
  if ((await reviewTargets.count()) > 0) {
    return
  }

  await page.waitForFunction(
    (prefix) => document.querySelectorAll(`[data-testid^="${prefix}-"]`).length > 0,
    workbenchSelectors.assistantTurnStepsPrefix
  )
  const stepToggles = page.locator(`[data-testid^="${workbenchSelectors.assistantTurnStepsPrefix}-"]`)
  const toggleCount = await stepToggles.count()
  if (toggleCount === 0) {
    throw new Error('assistant turn steps toggle not found')
  }
  await stepToggles.nth(toggleCount - 1).click()
}

export const waitForReviewTargets = async (page: Page, expectedCount: number): Promise<void> => {
  await page.waitForFunction(
    (input: { prefix: string; count: number }) =>
      document.querySelectorAll(`[data-testid^="${input.prefix}-"]`).length >= input.count,
    {
      prefix: workbenchSelectors.assistantTurnReviewPrefix,
      count: expectedCount
    }
  )
}

export const openReviewTargetAt = async (page: Page, index: number): Promise<void> => {
  const reviewTargets = page.locator(
    `[data-testid^="${workbenchSelectors.assistantTurnReviewPrefix}-"]`
  )
  await reviewTargets.nth(index).click()
  await page.getByTestId(workbenchSelectors.reviewPanel).waitFor()
}
