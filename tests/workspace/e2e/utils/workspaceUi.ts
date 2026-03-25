import type { Page } from 'playwright'
import {
  importSelectors,
  settingsSelectors,
  workbenchSelectors
} from '../../../../src/renderer/src/testing/selectors'

const E2E_WORKSPACE_CARD_ID = 'e2e-import-workspace-1'

export const openWorkspaceSettings = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/settings/workspace'
  })
  await page.waitForSelector(`[data-testid="${settingsSelectors.workspacePanel}"]`)
}

export const openWebSourceSettings = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/settings/web-sources'
  })
  await page.waitForSelector(`[data-testid="${importSelectors.webSourceSection}"]`)
}

export const openWorkbench = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/'
  })
  await page.waitForSelector(`[data-testid="${workbenchSelectors.page}"]`)
}

export const createFixtureWorkspaceFromSettings = async (
  page: Page,
  input: {
    rootPath: string
    name: string
  }
): Promise<void> => {
  await page.evaluate(async ({ rootPath, name }) => {
    const response = await window.api.workspaceCreate({ rootPath, name })
    if (!response.success) {
      throw new Error(response.error || 'workspace create failed')
    }
  }, input)
  await page.waitForSelector(
    `[data-testid="${importSelectors.workspaceCardPrefix}-${E2E_WORKSPACE_CARD_ID}"]`
  )
}

export const selectSourceScope = async (
  page: Page,
  input: {
    workspaceLabel: string
    query: string
    label: string
  }
): Promise<void> => {
  const workspaceSelect = page.getByTestId(workbenchSelectors.workspaceSelect)
  await workspaceSelect.locator('.ant-select-selector').click()
  await page.locator('.ant-select-dropdown').getByText(input.workspaceLabel).first().click()
  await page.waitForTimeout(120)

  const editor = page.getByTestId(workbenchSelectors.input)
  await editor.click()
  await editor.focus()
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
  await page.keyboard.type(`@${input.query}`)
  await page.getByTestId(workbenchSelectors.mentionPanel).getByText(input.label).first().click()
  await editor.getByText(input.label).waitFor()
}
