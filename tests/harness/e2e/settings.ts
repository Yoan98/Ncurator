import type { Locator, Page } from 'playwright'
import type {
  CreateWorkspaceSourceRequest,
  LLMConfig,
  WorkspaceIndexJobRecord,
  WorkspaceTreeListResponse,
  WorkspaceMutationResponse
} from '../../../src/shared/types'
import type { ModelInfo, SettingsE2EApiOverrides } from '../../../src/preload/api'
import {
  importSelectors,
  settingsSelectors,
  vectorSelectors
} from '../../../src/renderer/src/testing/selectors'

export type SettingsPageTarget = 'model' | 'workspace' | 'vector'

export const SETTINGS_E2E_TIMEOUT_MS = 30_000
export const SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS = 180_000
export const SETTINGS_WEB_E2E_TIMEOUT_MS = SETTINGS_E2E_TIMEOUT_MS

const byTestId = (testId: string): string => `[data-testid="${testId}"]`

const byTestIdPrefix = (testIdPrefix: string): string => `[data-testid^="${testIdPrefix}-"]`

const SETTINGS_TARGET_HEADINGS: Record<SettingsPageTarget, string> = {
  model: '大模型',
  workspace: '工作空间',
  vector: '向量模型'
}

const SETTINGS_TARGET_HASHES: Record<SettingsPageTarget, string> = {
  model: '#/settings/model',
  workspace: '#/settings/workspace',
  vector: '#/model-download'
}

const SETTINGS_TARGET_SELECTORS: Record<SettingsPageTarget, string> = {
  model: settingsSelectors.page,
  workspace: settingsSelectors.page,
  vector: vectorSelectors.page
}

export const getSettingsLocator = (page: Page, testId: string): Locator =>
  page.locator(byTestId(testId))

export const getSettingsPrefixLocator = (page: Page, testIdPrefix: string): Locator =>
  page.locator(byTestIdPrefix(testIdPrefix))

export const navigateToSettingsSection = async (
  page: Page,
  section: SettingsPageTarget
): Promise<void> => {
  await page.evaluate((nextHash: string) => {
    window.location.hash = nextHash
  }, SETTINGS_TARGET_HASHES[section])
  await getSettingsLocator(page, SETTINGS_TARGET_SELECTORS[section]).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: SETTINGS_TARGET_HEADINGS[section] }).first().waitFor({
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
  await page.evaluate(
    async (input) => {
      for (const config of input.configs) {
        const response = await window.api.llmConfigSave(config)
        if (!response.success) {
          throw new Error(response.error || 'failed to save llm config fixture')
        }
      }
    },
    { configs }
  )
}

export const seedModelCatalogOverride = async (
  page: Page,
  items: readonly ModelInfo[]
): Promise<void> => {
  await setSettingsE2EApiOverrides(page, {
    modelCatalog: {
      items: [...items]
    }
  })
}

export const createFixtureWorkspace = async (
  page: Page,
  payload: CreateWorkspaceSourceRequest & { rootPath?: string }
): Promise<WorkspaceMutationResponse> => {
  const response = await page.evaluate(async (input) => {
    return await window.api.workspaceCreate(input)
  }, payload)
  if (!response.success || !response.workspace) {
    throw new Error(response.error || 'failed to create workspace fixture')
  }
  return response
}

export const createRealWorkspaceWithRoot = async (
  page: Page,
  input: { name: string; rootPath: string }
): Promise<WorkspaceMutationResponse> => {
  const response = await page.evaluate(async (payload) => {
    const created = await window.api.workspaceCreate({ name: payload.name })
    if (!created.success || !created.workspace) {
      return created
    }
    const rooted = await window.api.workspaceSetRootPath({
      workspaceId: created.workspace.id,
      rootPath: payload.rootPath
    })
    if (!rooted.success) {
      return rooted
    }
    return rooted
  }, input)
  if (!response.success || !response.workspace) {
    throw new Error(response.error || 'failed to create real workspace')
  }
  return response
}

export const readWorkspaceTree = async (
  page: Page,
  workspaceId: string
): Promise<WorkspaceTreeListResponse> =>
  await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspaceTree({
      workspaceId: selectedWorkspaceId,
      includeUnsupported: true
    })
  }, workspaceId)

export const waitForFileIndexJobIdle = async (
  page: Page,
  workspaceId: string,
  timeoutMs = SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
): Promise<{ lastRunningJob?: WorkspaceIndexJobRecord; tree: WorkspaceTreeListResponse }> => {
  const deadline = Date.now() + timeoutMs
  let lastRunningJob: WorkspaceIndexJobRecord | undefined
  let tree = await readWorkspaceTree(page, workspaceId)

  for (;;) {
    const response = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceIndexJobGet({
        workspaceId: selectedWorkspaceId,
        sourceKind: 'file'
      })
    }, workspaceId)
    if (!response.success) {
      throw new Error(response.error || 'failed to read file index job')
    }
    if (!response.job) {
      return {
        lastRunningJob,
        tree: await readWorkspaceTree(page, workspaceId)
      }
    }
    lastRunningJob = response.job
    tree = await readWorkspaceTree(page, workspaceId)
    if (Date.now() >= deadline) {
      throw new Error('file index job did not become idle')
    }
    await page.waitForTimeout(500)
  }
}

export const getWorkspaceIndexCounts = async (
  page: Page
): Promise<{ actionableCount: number; failedHint: string }> => {
  const failedHintLocator = getSettingsLocator(page, importSelectors.workspaceActionableFailedHint)
  return {
    actionableCount: Number(
      (await getSettingsLocator(page, importSelectors.workspaceActionableIndexCount).textContent()) ||
        0
    ),
    failedHint: (await failedHintLocator.count())
      ? (await failedHintLocator.textContent()) || ''
      : ''
  }
}

export const seedWebSources = async (
  page: Page,
  workspaceId: string,
  urls: readonly string[]
): Promise<void> => {
  await page.evaluate(
    async (input) => {
      const response = await window.api.ingestWebs(
        input.urls.map((url) => ({
          workspaceId: input.workspaceId,
          url
        }))
      )
      if (!response.success) {
        throw new Error(response.error || 'failed to ingest web source fixtures')
      }
    },
    { workspaceId, urls }
  )
}

export const waitForWebIndexJobIdle = async (page: Page, workspaceId: string): Promise<void> => {
  const deadline = Date.now() + 5000
  for (;;) {
    const response = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceIndexJobGet({
        workspaceId: String(selectedWorkspaceId || ''),
        sourceKind: 'web'
      })
    }, workspaceId)
    if (response.success && !response.job) return
    if (Date.now() >= deadline) {
      throw new Error('web index job did not become idle')
    }
    await page.waitForTimeout(100)
  }
}

export const workspaceCardLocator = (page: Page, workspaceId: string): Locator =>
  getSettingsLocator(page, `${importSelectors.workspaceCardPrefix}-${workspaceId}`)

export const webSourceCardLocator = (page: Page, webSourceId: string): Locator =>
  getSettingsLocator(page, `${importSelectors.webSourceCardPrefix}-${webSourceId}`)
