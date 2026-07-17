import fs from 'node:fs/promises'
import path from 'node:path'
import { getSlides, getSlideText, loadPresentation } from 'pptx-kit'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  getWorkbenchLocator,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchApplyRecordStatus,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'ppt-create-diff-and-revert'
const FILE_NAME = 'Workbench-PPT验收.pptx'
const MARKER = 'ORBIT-PPT-731'

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
          '真实 AI 创建 PPT 后，验证修改文件入口、分页左右 Diff、缩略图筛选和新建文件回撤。',
        fixtures: [],
        launchMode: 'real',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            rootBindingMode: 'ipc'
          })
          try {
            const filePath = path.join(setup.workspace.rootPath, FILE_NAME)
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(
              page,
              `请直接在工作区创建“${FILE_NAME}”。做两页简洁专业的 16:9 PPT：第一页标题包含“季度复盘”，第二页标题包含“下一步”，两页正文都要出现唯一标记“${MARKER}”。必须使用 PPT 工具逐页创建，每次只生成一个页面 HTML，完成后告诉我已写回。`
            )
            const evidence = await waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)
            const bytes = new Uint8Array(await fs.readFile(filePath))
            const presentation = await loadPresentation(bytes)
            const slideText = getSlides(presentation)
              .map((slide) => getSlideText(slide))
              .join('\n')
            const applyEntry = await waitForApplyEntry(page)
            const applyEntryText = ((await applyEntry.textContent()) || '').trim()
            await applyEntry.click()
            await getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer).waitFor({
              state: 'visible',
              timeout: 30_000
            })
            const beforeVisible = await getWorkbenchLocator(
              page,
              workbenchSelectors.pptDiffBefore
            ).isVisible()
            const afterVisible = await getWorkbenchLocator(
              page,
              workbenchSelectors.pptDiffAfter
            ).isVisible()
            const changedThumbCount = await getWorkbenchLocator(
              page,
              workbenchSelectors.pptDiffThumbnails
            )
              .locator('button')
              .count()
            await getWorkbenchLocator(page, workbenchSelectors.pptDiffViewer)
              .getByLabel('查看全部页')
              .click()
            const allThumbCount = await getWorkbenchLocator(
              page,
              workbenchSelectors.pptDiffThumbnails
            )
              .locator('button')
              .count()
            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            await page.getByText('删除这个新建文件？').waitFor({ state: 'visible' })
            await page.getByRole('button', { name: '恢复到此前版本' }).click()
            await waitForWorkbenchApplyRecordStatus(page, 'reverted')
            const existsAfterRevert = await fs
              .access(filePath)
              .then(() => true)
              .catch(() => false)
            return {
              slideCount: getSlides(presentation).length,
              slideText,
              applyEntryText,
              beforeVisible,
              afterVisible,
              changedThumbCount,
              allThumbCount,
              existsAfterRevert,
              pptToolCalls: evidence.events.filter(
                (event) => event.type === 'tool_call_started' && event.toolName === 'ppt_edit'
              ).length,
              pptArtifacts: evidence.events.filter(
                (event) => event.type === 'file_artifact' && event.capability === 'ppt'
              ).length
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.slideCount === 2 &&
              result.slideText.includes(MARKER) &&
              result.applyEntryText.includes(FILE_NAME) &&
              result.beforeVisible &&
              result.afterVisible &&
              result.changedThumbCount === 2 &&
              result.allThumbCount === 2 &&
              result.existsAfterRevert === false &&
              result.pptToolCalls >= 2 &&
              result.pptArtifacts === 1,
            {
              name: 'workbench-ppt-create-diff-revert-real',
              message:
                '真实 AI 创建 PPT 后应展示页面级左右 Diff 和缩略图筛选，并可通过现有回撤删除新建文件，对齐 WB-PPT-001、WB-PPT-002、WB-APPLY-003。',
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
