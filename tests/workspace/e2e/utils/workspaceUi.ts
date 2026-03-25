import type { Page } from 'playwright'
import {
  importSelectors,
  settingsSelectors,
  workbenchSelectors
} from '../../../../src/renderer/src/testing/selectors'

const E2E_WORKSPACE_CARD_ID = 'e2e-import-workspace-1'

export const openWorkspaceSettings = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.location.hash = '#/settings?tab=workspace'
  })
  await page.waitForSelector(`[data-testid="${settingsSelectors.workspacePanel}"]`)
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
  await page.getByTestId(importSelectors.createWorkspaceButton).click()
  await page.getByTestId(importSelectors.createWorkspaceRootInput).fill(input.rootPath)
  await page.getByTestId(importSelectors.createWorkspaceNameInput).fill(input.name)
  await page.getByTestId(importSelectors.createWorkspaceConfirmButton).click()
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

  const editor = page.getByTestId(workbenchSelectors.input)
  await editor.click()
  await editor.focus()
  await page.waitForFunction(
    (testId) => document.activeElement?.getAttribute('data-testid') === testId,
    workbenchSelectors.input
  )
  await page.keyboard.type(`@${input.query}`)
  await page.getByTestId(workbenchSelectors.mentionPanel).getByText(input.label).first().click()
  await editor.getByText(input.label).waitFor()
}
