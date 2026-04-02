import type { Locator, Page } from 'playwright'
import type {
  CreateWorkspaceSourceRequest,
  LegacyLocalImportMigrationStatus,
  LLMConfig,
  PickDirectoryResponse,
  WorkspaceListResponse,
  WorkspaceMutationResponse,
  WorkspaceNodeListResponse
} from '../../../src/shared/types'
import { importSelectors, settingsSelectors } from '../../../src/renderer/src/testing/selectors'

export type SettingsSection = 'model' | 'workspace'

export const SETTINGS_E2E_TIMEOUT_MS = 30_000
export const SETTINGS_WEB_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS

export type SettingsE2EApiOverrides = {
  pickDirectoryResponse?: PickDirectoryResponse
  workspaceListResponse?: WorkspaceListResponse
  workspaceNodesResponseByWorkspaceId?: Record<string, WorkspaceNodeListResponse>
  legacyLocalImportMigrationStatus?: LegacyLocalImportMigrationStatus | null
  llmConfigDeleteResponseById?: Record<string, { success: boolean; error?: string }>
  webSourceRefreshDelayMs?: number
}

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

const SETTINGS_SECTION_HEADINGS: Record<SettingsSection, string> = {
  model: '大模型',
  workspace: '工作空间'
}

export const getSettingsLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getSettingsPrefixLocator = (page: Page, testIdPrefix: string): Locator =>
  page.locator(byTestIdPrefix(testIdPrefix))

export const navigateToSettingsSection = async (
  page: Page,
  section: SettingsSection
): Promise<void> => {
  await page.evaluate((nextHash) => {
    window.location.hash = nextHash
  }, `#/settings/${section}`)
  await getSettingsLocator(page, settingsSelectors.page).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: SETTINGS_SECTION_HEADINGS[section] }).first().waitFor({
    state: 'visible'
  })
}

export const waitForAntMessage = async (page: Page, text: string): Promise<void> => {
  await page.locator('.ant-message').getByText(text).last().waitFor({
    state: 'visible'
  })
}

export const setSettingsE2EApiOverrides = async (
  page: Page,
  overrides: SettingsE2EApiOverrides
): Promise<void> => {
  await page.evaluate((input) => {
    window.api.setE2EApiOverrides(input)
  }, overrides)
}

export const clearSettingsE2EApiOverrides = async (page: Page): Promise<void> => {
  await page.evaluate(() => {
    window.api.clearE2EApiOverrides()
  })
}

export const seedModelConfigs = async (
  page: Page,
  configs: readonly LLMConfig[]
): Promise<void> => {
  await page.evaluate(async (input) => {
    for (const config of input.configs) {
      const response = await window.api.llmConfigSave(config)
      if (!response.success) {
        throw new Error(response.error || 'failed to save llm config fixture')
      }
    }
  }, { configs })
}

export const createFixtureWorkspace = async (
  page: Page,
  payload: CreateWorkspaceSourceRequest
): Promise<WorkspaceMutationResponse> => {
  const response = await page.evaluate(async (input) => {
    return await window.api.workspaceCreate(input)
  }, payload)
  if (!response.success || !response.workspace) {
    throw new Error(response.error || 'failed to create workspace fixture')
  }
  return response
}

export const seedWebSources = async (
  page: Page,
  workspaceId: string,
  urls: readonly string[]
): Promise<void> => {
  await page.evaluate(async (input) => {
    const response = await window.api.ingestWebs(
      input.urls.map((url) => ({
        workspaceId: input.workspaceId,
        url
      }))
    )
    if (!response.success) {
      throw new Error(response.error || 'failed to ingest web source fixtures')
    }
  }, { workspaceId, urls })
}

export const workspaceCardLocator = (page: Page, workspaceId: string): Locator =>
  getSettingsLocator(page, `${importSelectors.workspaceCardPrefix}-${workspaceId}`)

export const webSourceCardLocator = (page: Page, webSourceId: string): Locator =>
  getSettingsLocator(page, `${importSelectors.webSourceCardPrefix}-${webSourceId}`)
