import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LONG_E2E_TIMEOUT_MS,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  configureLiveModelThroughSettingsUi,
  createTemporaryWorkbenchWorkspace,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  loadWorkbenchLiveModelEnv,
  navigateToWorkbench,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  selectWorkbenchModel,
  selectWorkbenchWorkspace,
  sendWorkbenchMessage,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import {
  createRealWorkspaceWithRoot,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

const CASE_ID = 'multi-file-apply-tabs'
const FIRST_FILE = '人工智能探究课堂PRD.docx'
const SECOND_FILE = '交互式探究学习案例：产业转移.docx'
const FIRST_MARKER = 'cedar-multi-apply-prd-141'
const SECOND_MARKER = 'cedar-multi-apply-case-242'

const waitForApplyPanelFile = async (
  page: Parameters<typeof getWorkbenchLocator>[0],
  fileName: string
): Promise<void> => {
  await waitForWorkbenchApplyPanelReady(page)
  await page.waitForFunction(
    ({ panelTestId, expectedFileName }) => {
      const panel = document.querySelector(`[data-testid="${panelTestId}"]`)
      return panel instanceof HTMLElement && panel.innerText.includes(expectedFileName)
    },
    {
      panelTestId: workbenchSelectors.applyPanel,
      expectedFileName: fileName
    },
    { timeout: 30_000 }
  )
}

const setupMultiFileApplyWorkspace = async (
  page: Page
): Promise<{
  env: ReturnType<typeof loadWorkbenchLiveModelEnv>
  workspace: Awaited<ReturnType<typeof createTemporaryWorkbenchWorkspace>>
  workspaceName: string
}> => {
  const env = loadWorkbenchLiveModelEnv()
  const workspace = await createTemporaryWorkbenchWorkspace(CASE_ID)
  const workspaceName = `Workbench ${CASE_ID}`

  await configureLiveModelThroughSettingsUi(page, env)
  const workspaceResponse = await createRealWorkspaceWithRoot(page, {
    name: workspaceName,
    rootPath: workspace.rootPath
  })
  const workspaceId = workspaceResponse.workspace!.id
  const prepareResponse = await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspacePrepare({ workspaceId: selectedWorkspaceId })
  }, workspaceId)
  if (!prepareResponse.success) {
    throw new Error(prepareResponse.error || 'failed to prepare workspace fixture')
  }
  await waitForFileIndexJobIdle(page, workspaceId, WORKBENCH_LONG_E2E_TIMEOUT_MS)
  await navigateToWorkbench(page)
  await selectWorkbenchWorkspace(page, workspaceName)
  await selectWorkbenchModel(page, env.modelName)

  return {
    env,
    workspace,
    workspaceName
  }
}

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description:
          '真实 AI 同一轮修改两个 docx 后，验证 assistant 多入口、右侧仅展示当前点击文件并切换对应记录。',
        fixtures: ['tests/fixtures/workspace'],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupMultiFileApplyWorkspace(page)
          try {
            const firstPath = path.join(setup.workspace.rootPath, FIRST_FILE)
            const secondPath = path.join(setup.workspace.rootPath, SECOND_FILE)
            const firstBeforeText = await readDocxPlainText(firstPath)
            const secondBeforeText = await readDocxPlainText(secondPath)
            await insertWorkbenchReferenceToken(page, FIRST_FILE)
            await insertWorkbenchReferenceToken(page, SECOND_FILE)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(
              page,
              `请直接修改我刚选中的两份 docx：在 ${FIRST_FILE} 文末新增“${FIRST_MARKER}”；在 ${SECOND_FILE} 文末新增“${SECOND_MARKER}”。请分别写回原文件，不要新建文件。`
            )
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)
            const firstAfterText = await readDocxPlainText(firstPath)
            const secondAfterText = await readDocxPlainText(secondPath)
            await getWorkbenchPrefixLocator(page, workbenchSelectors.assistantTurnApplyPrefix)
              .first()
              .waitFor({ state: 'visible' })
            const applyEntryCount = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantTurnApplyPrefix
            ).count()
            const firstEntry = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantTurnApplyPrefix
            )
              .filter({ hasText: FIRST_FILE })
              .first()
            const secondEntry = getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantTurnApplyPrefix
            )
              .filter({ hasText: SECOND_FILE })
              .first()
            const firstEntryText = ((await firstEntry.textContent()) || '').trim()
            const secondEntryText = ((await secondEntry.textContent()) || '').trim()
            await firstEntry.click()
            await waitForApplyPanelFile(page, FIRST_FILE)
            const afterFirstEntryText = (
              (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
            ).trim()
            const firstModeTagText = (
              (await getWorkbenchLocator(
                page,
                workbenchSelectors.documentPreviewModeTag
              ).textContent()) || ''
            ).trim()
            await secondEntry.click()
            await waitForApplyPanelFile(page, SECOND_FILE)
            const afterSecondEntryText = (
              (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
            ).trim()
            await firstEntry.click()
            await waitForApplyPanelFile(page, FIRST_FILE)
            const afterFirstEntryAgainText = (
              (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
            ).trim()
            const applyPanelCount = await getWorkbenchLocator(
              page,
              workbenchSelectors.applyPanel
            ).count()
            const legacyTabsCount = await page
              .locator('[data-testid="workbench-apply-tabs"]')
              .count()

            return {
              firstBeforeText,
              secondBeforeText,
              firstAfterText,
              secondAfterText,
              applyEntryCount,
              firstEntryText,
              secondEntryText,
              afterFirstEntryText,
              afterSecondEntryText,
              afterFirstEntryAgainText,
              firstModeTagText,
              applyPanelCount,
              legacyTabsCount,
              fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
                .length
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.firstBeforeText.includes(FIRST_MARKER) &&
              !result.secondBeforeText.includes(SECOND_MARKER) &&
              result.firstAfterText.includes(FIRST_MARKER) &&
              result.secondAfterText.includes(SECOND_MARKER) &&
              result.applyEntryCount >= 2 &&
              result.fileArtifactCount >= 2 &&
              result.firstEntryText.includes(FIRST_FILE) &&
              result.secondEntryText.includes(SECOND_FILE) &&
              result.firstEntryText.includes('Workbench multi-file-apply-tabs') &&
              result.secondEntryText.includes('Workbench multi-file-apply-tabs') &&
              result.afterFirstEntryText.includes(FIRST_FILE) &&
              !result.afterFirstEntryText.includes(SECOND_FILE) &&
              result.afterSecondEntryText.includes(SECOND_FILE) &&
              !result.afterSecondEntryText.includes(FIRST_FILE) &&
              result.afterFirstEntryAgainText.includes(FIRST_FILE) &&
              !result.afterFirstEntryAgainText.includes(SECOND_FILE) &&
              result.firstModeTagText === '编辑' &&
              result.applyPanelCount === 1 &&
              result.legacyTabsCount === 0,
            {
              name: 'workbench-multi-file-apply-single-preview-real',
              message:
                '同一轮 AI 修改多个 docx 时，assistant turn 应保留多个修改入口；右侧只展示当前点击的文件记录，不再提供右侧文件 tab，对齐 WB-APPLY-005、WB-APPLY-001。',
              data: result
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
