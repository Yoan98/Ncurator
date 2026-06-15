import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForWorkbenchApplyPanelReady,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'multi-file-apply-tabs'
const FIRST_FILE = '人工智能探究课堂PRD.docx'
const SECOND_FILE = '交互式探究学习案例：产业转移.docx'
const FIRST_MARKER = 'cedar-multi-apply-prd-141'
const SECOND_MARKER = 'cedar-multi-apply-case-242'

describe('workbench result e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: '真实 AI 同一轮修改两个 docx 后，验证 assistant 多入口、右侧多 tab 和切换状态保持。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
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
          await getWorkbenchPrefixLocator(page, workbenchSelectors.assistantTurnApplyPrefix)
            .first()
            .click()
          await waitForWorkbenchApplyPanelReady(page)
          const tabsText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyTabs).textContent()) ||
              '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyTabs)
            .getByText(SECOND_FILE)
            .click()
          await waitForWorkbenchApplyPanelReady(page)
          const afterSecondTabText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) ||
              '').trim()
          await getWorkbenchLocator(page, workbenchSelectors.applyTabs)
            .getByText(FIRST_FILE)
            .click()
          await waitForWorkbenchApplyPanelReady(page)
          const afterFirstTabText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) ||
              '').trim()

          return {
            firstBeforeText,
            secondBeforeText,
            firstAfterText,
            secondAfterText,
            applyEntryCount,
            tabsText,
            afterSecondTabText,
            afterFirstTabText,
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
            result.tabsText.includes(FIRST_FILE) &&
            result.tabsText.includes(SECOND_FILE) &&
            result.afterSecondTabText.includes(SECOND_FILE) &&
            result.afterFirstTabText.includes(FIRST_FILE),
          {
            name: 'workbench-multi-file-apply-tabs-real',
            message:
              '同一轮 AI 修改多个 docx 时，assistant turn 应保留多个修改入口，右侧 apply 工作区应一文件一 tab 并能切换对应记录，对齐 WB-APPLY-005、WB-APPLY-001。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
