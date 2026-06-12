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
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-apply-panel-preview-and-revert'
const MARKER = 'cedar-apply-731'

describe('workbench result e2e', () => {
  it(CASE_ID, async () => {
    await runE2ECase({
      caseId: CASE_ID,
      domain: 'workbench',
      suite: 'result',
      groups: ['apply'],
      description: '真实 AI 修改真实 docx 后，验证 assistant 修改入口、右侧预览和干净回退。',
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
            `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench apply marker ${MARKER}”。完成后告诉我已写回。`
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
          const applyPanelText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) ||
              '').trim()
          const docxViewerVisible = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .isVisible()
            .catch(() => false)
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('已回退本次修改').waitFor({ state: 'visible' })
          const afterRevertText = await readDocxPlainText(targetPath)
          const revertedPanelText =
            ((await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) ||
              '').trim()

          return {
            beforeText,
            afterApplyText,
            afterRevertText,
            applyPanelText,
            revertedPanelText,
            docxViewerVisible,
            fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
              .length
          }
        } finally {
          await setup.workspace.cleanup()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          !result.beforeText.includes(MARKER) &&
            result.afterApplyText.includes(MARKER) &&
            result.afterRevertText === result.beforeText &&
            result.applyPanelText.includes('回退本次修改') &&
            result.revertedPanelText.includes('已回退') &&
            result.docxViewerVisible &&
            result.fileArtifactCount >= 1,
          {
            name: 'workbench-docx-apply-preview-revert-real',
            message:
              'AI 修改真实 docx 后应展示修改文件入口和右侧 apply 工作区；无后续修改时回退应恢复 checkpoint 并刷新状态，对齐 WB-APPLY-001、WB-APPLY-002、WB-APPLY-003、WB-PANEL-003。',
            data: result
          }
        )
        await assertNoWorkbenchFakeSignals(runtime)
      }
    })
  }, WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS)
})
