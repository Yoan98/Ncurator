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
    fieldTestId: string
    label: string
  }
): Promise<void> => {
  const field = page.getByTestId(input.fieldTestId)
  await field.locator('.ant-select-selector').click()
  await page.getByText(input.label, { exact: true }).click()
  await field.locator('.ant-select-selection-item').filter({ hasText: input.label }).waitFor()
}
