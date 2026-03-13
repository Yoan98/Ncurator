import { afterEach, describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import type { UiAssertion } from '../../../harness/e2e/reporter'
import { launchElectronApp, type LaunchedElectronApp } from '../../../harness/e2e/electronApp'
import { finalizeElectronUiCase } from '../../../harness/e2e/uiCase'

const CASE_METADATA = {
  description: '验证 Import 页面通过真实 Electron 链路创建、扫描并准备工作区。',
  taskGoal: 'Create an import workspace, run scan, then run prepare and verify prepared state is rendered.',
  scenarioTags: ['e2e', 'import', 'workspace', 'deterministic'],
  expectedOutcome: 'success',
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'import-ui'
} as const

const openImportPage = async (appPage: LaunchedElectronApp['page'], userActionSequence: string[]) => {
  await appPage.evaluate(() => {
    window.location.hash = '#/import'
  })
  userActionSequence.push('navigate:#/import')
  await appPage.getByTestId(importSelectors.page).waitFor({
    timeout: 10_000
  })
}

describe('import.workspace-flow.e2e', () => {
  let app: LaunchedElectronApp | null = null

  afterEach(async () => {
    if (app) {
      await app.electronApp.close()
      app = null
    }
  })

  it('creates, scans, and prepares a workspace through the real Electron import flow', async () => {
    const startedAt = Date.now()
    const userActionSequence: string[] = []
    const selectorFailures: string[] = []
    const assertions: UiAssertion[] = []
    const notes: string[] = []
    let runtimeError: Error | null = null

    try {
      app = await launchElectronApp()
      await openImportPage(app.page, userActionSequence)

      await app.page.getByTestId(importSelectors.createWorkspaceButton).click()
      userActionSequence.push('click:import-create-workspace-button')

      await app.page.getByTestId(importSelectors.createWorkspaceRootInput).fill('/tmp/ncurator-e2e-import')
      userActionSequence.push('fill:import-root-path')
      await app.page.getByTestId(importSelectors.createWorkspaceNameInput).fill('E2E 导入工作区')
      userActionSequence.push('fill:import-workspace-name')
      await app.page.getByTestId(importSelectors.createWorkspaceConfirmButton).click()
      userActionSequence.push('click:import-create-workspace-confirm-button')

      await app.page.getByTestId(`${importSelectors.workspaceCardPrefix}-e2e-import-workspace-1`).waitFor({
        timeout: 10_000
      })
      await app.page.getByTestId(importSelectors.workspaceStatus).waitFor({
        timeout: 10_000
      })
      await app.page.waitForSelector('text=未准备', { timeout: 10_000 })
      assertions.push({ id: 'import-workspace-created', pass: true })

      await app.page.getByTestId(importSelectors.workspaceQuickScanButton).click()
      userActionSequence.push('click:import-workspace-quick-scan-button')
      await app.page.waitForSelector('text=待更新', { timeout: 10_000 })
      assertions.push({ id: 'import-workspace-scanned', pass: true })

      await app.page.getByTestId(importSelectors.workspaceQuickPrepareButton).click()
      userActionSequence.push('click:import-workspace-quick-prepare-button')
      await app.page.waitForSelector('text=已准备', { timeout: 10_000 })
      await app.page.getByTestId(importSelectors.workspaceTree).waitFor({
        timeout: 10_000
      })
      await app.page.waitForSelector('text=brief.txt', { timeout: 10_000 })
      assertions.push({ id: 'import-workspace-prepared', pass: true })
    } catch (error) {
      runtimeError = error instanceof Error ? error : new Error(String(error))
      selectorFailures.push('import-workspace-flow')
      notes.push(runtimeError.message)
      assertions.push({
        id: 'import-workspace-flow',
        pass: false,
        details: runtimeError.message
      })
    }

    await finalizeElectronUiCase({
      app,
      suite: 'e2e-import',
      caseId: 'import-workspace-create-scan-prepare',
      caseMetadata: CASE_METADATA,
      startedAt,
      assertions,
      notes,
      userActionSequence,
      selectorFailures,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      taskGoal: CASE_METADATA.taskGoal
    })

    app = null

    if (runtimeError) {
      throw runtimeError
    }
  })
})
