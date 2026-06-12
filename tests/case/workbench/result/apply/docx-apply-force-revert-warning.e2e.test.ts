import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  insertWorkbenchReferenceToken,
  mutateDocxExternally,
  readDocxPlainText,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-apply-force-revert-warning'
const MARKER = 'cedar-force-revert-918'

describe('workbench result e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: 'AI 写回后测试进程真实外部改 docx，验证首次回退风险提示和确认后强制回退。',
      fixtures: ['tests/fixtures/workspace'],
      launchMode: 'real',
      windowMode: 'visible',
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
        try {
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          const beforeText = await readDocxPlainText(targetPath)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench force revert marker ${MARKER}”。完成后告诉我已写回。`
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAtMs,
            setup.env.modelName
          )
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          const afterApplyText = await readDocxPlainText(targetPath)
          const applyEntry = await waitForApplyEntry(page)
          await applyEntry.click()
          await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
            state: 'visible'
          })

          await mutateDocxExternally(targetPath, `external-${MARKER}`)
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('恢复到本次修改前？').waitFor({ state: 'visible' })
          const warningText = ((await page.locator('.ant-modal').last().textContent()) || '').trim()
          await page.getByRole('button', { name: '恢复到此前版本' }).click()
          await page.getByText('已回退本次修改').waitFor({ state: 'visible' })
          const afterForceRevertText = await readDocxPlainText(targetPath)
          const panelText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) ||
              '').trim()

          return {
            beforeText,
            afterApplyText,
            warningText,
            afterForceRevertText,
            panelText
          }
        } finally {
          await setup.workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          !result.beforeText.includes(MARKER) &&
            result.afterApplyText.includes(MARKER) &&
            /又发生了变化|丢失之后的修改|恢复到这次修改前/u.test(result.warningText) &&
            result.afterForceRevertText === result.beforeText &&
            result.panelText.includes('已回退'),
          {
            name: 'workbench-docx-force-revert-warning-real',
            message:
              'AI 写回后若文件被外部真实修改，首次回退应展示风险提示；确认后才强制恢复并刷新状态，对齐 WB-APPLY-004-AC1 至 WB-APPLY-004-AC3。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
