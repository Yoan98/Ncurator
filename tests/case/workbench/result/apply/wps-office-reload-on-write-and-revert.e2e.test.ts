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
import { connectWpsSyncEvents, countWpsReloadsForPath } from '../../../../harness/e2e/wpsSync'

const CASE_ID = 'wps-office-reload-on-write-and-revert'
const MARKER = 'wps-reload-e2e-914'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 写回并回退 docx 后，WPS 回环通道收到对应路径的 reload。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          const probe = await connectWpsSyncEvents()
          try {
            const beforeText = await readDocxPlainText(targetPath)
            await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(
              page,
              `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench WPS reload marker ${MARKER}”。完成后告诉我已写回。`
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
            const applyReloadCount = countWpsReloadsForPath(probe.events, targetPath)
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
            const revertDeadline = Date.now() + 8_000
            while (
              Date.now() < revertDeadline &&
              countWpsReloadsForPath(probe.events, targetPath) <= applyReloadCount
            ) {
              await new Promise((resolve) => setTimeout(resolve, 50))
            }
            return {
              beforeText,
              afterApplyText,
              afterRevertText,
              applyReloadCount,
              revertReloadCount: countWpsReloadsForPath(probe.events, targetPath)
            }
          } finally {
            probe.close()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.beforeText.includes(MARKER) &&
              result.afterApplyText.includes(MARKER) &&
              result.afterRevertText === result.beforeText &&
              result.applyReloadCount >= 1 &&
              result.revertReloadCount > result.applyReloadCount,
            {
              name: 'workbench-wps-reload-on-write-and-revert',
              message:
                'AI 写回真实 docx 后 WPS 回环通道应立刻推送该路径 reload，回退成功后再推一次，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
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
