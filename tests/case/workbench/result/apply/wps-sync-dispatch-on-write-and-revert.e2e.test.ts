import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { waitForWpsDispatch } from '../../../../harness/e2e/wpsSync'

const CASE_ID = 'wps-sync-dispatch-on-write-and-revert'
const MARKER = 'wps-dispatch-e2e-914'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 写回并回退 docx 后，馆长回环 /status 记录对应路径的 reload dispatch。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          const beforeText = await readDocxPlainText(targetPath)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench WPS dispatch marker ${MARKER}”。完成后告诉我已写回。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const afterApplyText = await readDocxPlainText(targetPath)
          const applyDispatch = await waitForWpsDispatch({
            filePath: targetPath,
            afterAt: startedAtMs
          })
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
            state: 'visible'
          })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const afterRevertText = await readDocxPlainText(targetPath)
          const revertDispatch = await waitForWpsDispatch({
            filePath: targetPath,
            afterAt: startedAtMs,
            minCount: applyDispatch.count + 1
          })
          return {
            beforeText,
            afterApplyText,
            afterRevertText,
            applyDispatchCount: applyDispatch.count,
            revertDispatchCount: revertDispatch.count
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.beforeText.includes(MARKER) &&
              result.afterApplyText.includes(MARKER) &&
              result.afterRevertText === result.beforeText &&
              result.applyDispatchCount >= 1 &&
              result.revertDispatchCount > result.applyDispatchCount,
            {
              name: 'workbench-wps-sync-dispatch-on-write-and-revert',
              message:
                'AI 写回真实 docx 后馆长 /status 应记录该路径 dispatch，回退成功后再记一次，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
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
