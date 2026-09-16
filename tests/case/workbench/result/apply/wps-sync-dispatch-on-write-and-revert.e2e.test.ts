import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  readOfficePlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntryByFileName,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { WPS_OFFICE_COVERAGE_TARGETS, waitForWpsDispatch } from '../../../../harness/e2e/wpsSync'

const CASE_ID = 'wps-sync-dispatch-on-write-and-revert'
const MARKER = 'wps-dispatch-e2e-914'
const CASE_TIMEOUT_MS = WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS * WPS_OFFICE_COVERAGE_TARGETS.length

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
          '真实 AI 写回并回退 docx / xlsx / pptx 后，馆长回环 /status 对各路径记录 open dispatch。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const files: Array<{
            kind: string
            fileName: string
            marker: string
            beforeText: string
            afterApplyText: string
            afterRevertText: string
            applyDispatchCount: number
            revertDispatchCount: number
          }> = []
          for (const target of WPS_OFFICE_COVERAGE_TARGETS) {
            const targetPath = path.join(setup.workspace.rootPath, target.fileName)
            const marker = `${MARKER}-${target.kind}`
            const beforeText = await readOfficePlainText(targetPath)
            await insertWorkbenchReferenceToken(page, target.fileName)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(page, target.prompt(marker))
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)
            const afterApplyText = await readOfficePlainText(targetPath)
            const applyDispatch = await waitForWpsDispatch({
              filePath: targetPath,
              afterAt: startedAtMs
            })
            const applyEntry = await waitForApplyEntryByFileName(page, target.fileName)
            await applyEntry.click()
            await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
              state: 'visible'
            })
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
            await waitForWorkbenchApplyRecordStatus(page, 'reverted')
            const afterRevertText = await readOfficePlainText(targetPath)
            const revertDispatch = await waitForWpsDispatch({
              filePath: targetPath,
              afterAt: startedAtMs,
              minCount: applyDispatch.count + 1
            })
            files.push({
              kind: target.kind,
              fileName: target.fileName,
              marker,
              beforeText,
              afterApplyText,
              afterRevertText,
              applyDispatchCount: applyDispatch.count,
              revertDispatchCount: revertDispatch.count
            })
          }
          return { files }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.files.length === WPS_OFFICE_COVERAGE_TARGETS.length &&
              result.files.every(
                (file) =>
                  !file.beforeText.includes(file.marker) &&
                  file.afterApplyText.includes(file.marker) &&
                  file.afterRevertText === file.beforeText &&
                  file.applyDispatchCount >= 1 &&
                  file.revertDispatchCount > file.applyDispatchCount
              ),
            {
              name: 'workbench-wps-sync-dispatch-on-write-and-revert',
              message:
                'AI 写回真实 docx / xlsx / pptx 后馆长 /status 应记录各路径 dispatch，回退成功后再记一次，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
              data: result.files.map((file) => ({
                kind: file.kind,
                fileName: file.fileName,
                applyDispatchCount: file.applyDispatchCount,
                revertDispatchCount: file.revertDispatchCount,
                markerApplied: file.afterApplyText.includes(file.marker),
                reverted: file.afterRevertText === file.beforeText
              }))
            }
          )
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    CASE_TIMEOUT_MS
  )
})
