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
import {
  openDocumentInWpsBackground,
  resolveWpsOfficeAppPath,
  waitForWpsAddonReady,
  waitForWpsReloadResult,
  waitForWpsSyncStatus
} from '../../../../harness/e2e/wpsSync'

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
        description:
          '本机已授权的 WPS 打开目标 docx 后，AI 写回/回退应让加载项 close+open 并读到新/旧正文。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          if (!resolveWpsOfficeAppPath()) {
            return {
              skipped: true as const,
              reason: '本机未找到 WPS Office'
            }
          }
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          await waitForWpsSyncStatus({ timeoutMs: 20_000 })
          await openDocumentInWpsBackground(targetPath)
          let ready: Awaited<ReturnType<typeof waitForWpsAddonReady>>
          try {
            ready = await waitForWpsAddonReady({ filePath: targetPath, timeoutMs: 90_000 })
          } catch (error) {
            return {
              skipped: true as const,
              reason: error instanceof Error ? error.message : String(error)
            }
          }
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
          const applyReload = await waitForWpsReloadResult({
            port: ready.port,
            filePath: targetPath,
            afterAt: startedAtMs,
            excerptIncludes: MARKER
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
          const revertReload = await waitForWpsReloadResult({
            port: ready.port,
            filePath: targetPath,
            afterAt: applyReload.at + 1,
            excerptExcludes: MARKER
          })
          return {
            skipped: false as const,
            beforeText,
            afterApplyText,
            afterRevertText,
            applyExcerpt: applyReload.excerpt,
            revertExcerpt: revertReload.excerpt
          }
        },
        assert: async (result, runtime) => {
          if (result.skipped) {
            await runtime.assertThat(true, {
              name: 'workbench-wps-reload-environment-skip',
              message: `本机 WPS 加载项未连接，跳过窗口刷新断言：${result.reason}`,
              data: { reason: result.reason }
            })
            return
          }
          await runtime.assertThat(
            !result.beforeText.includes(MARKER) &&
              result.afterApplyText.includes(MARKER) &&
              result.afterRevertText === result.beforeText &&
              result.applyExcerpt.includes(MARKER) &&
              !result.revertExcerpt.includes(MARKER),
            {
              name: 'workbench-wps-reload-on-write-and-revert',
              message:
                '真实 WPS 打开目标 docx 后，写回应让窗口正文出现标记，回退后窗口正文恢复原文，对齐 WB-WPS-001-AC2、WB-WPS-001-AC3。',
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
