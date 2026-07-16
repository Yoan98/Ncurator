import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  appendWorkbenchInputText,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  switchWorkbenchMode,
  waitForApplyEntry,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchAiEvent,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchSearchResults,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'text-file-apply-preview-and-revert'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '验证普通文件正常预览、文本修改 diff 展示和按原始 bytes 回退。',
        fixtures: ['tests/fixtures/workspace'],
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
            const targetPath = path.join(setup.workspace.rootPath, 'workbench-preview.md')
            const beforeBytes = await fs.readFile(targetPath)

            await switchWorkbenchMode(page, '没头脑')
            await insertWorkbenchReferenceToken(page, 'workbench-preview.md')
            await appendWorkbenchInputText(page, 'cedar-markdown-preview-442')
            await submitWorkbenchCurrentDraft(page)
            const searchResults = await waitForWorkbenchSearchResults(page)
            await searchResults
              .locator('div')
              .filter({ hasText: 'workbench-preview.md' })
              .first()
              .getByRole('button', { name: '预览文件' })
              .click()
            await getWorkbenchLocator(page, workbenchSelectors.markdownViewer).waitFor({
              state: 'visible',
              timeout: 30_000
            })
            const normalPreviewMode = (
              (await getWorkbenchLocator(
                page,
                workbenchSelectors.documentPreviewModeTag
              ).textContent()) || ''
            ).trim()

            await switchWorkbenchMode(page, '大聪明')
            await insertWorkbenchReferenceToken(page, 'workbench-preview.md')
            const startedAtMs = Date.now()
            await sendWorkbenchMessage(
              page,
              '请直接修改 workbench-preview.md：使用 replaceAll 把所有 Preview 改为 DiffPreview，再把唯一的 cedar-markdown-preview-442 精确改成 cedar-text-diff-884。写入完成后必须先等待 5 秒，再读取文件确认。'
            )
            const completionPromise = waitForWorkbenchAiRunCompletion(
              runtime,
              startedAtMs,
              setup.env.modelName,
              WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
              { page, blockerPolicy: 'auto_approve' }
            )
            await waitForWorkbenchAiEvent(runtime, {
              name: 'text_file_artifact_before_run_completion',
              matches: (event) =>
                event.type === 'file_artifact' && event.fileName === 'workbench-preview.md'
            })
            const applyEntryCountDuringRun = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantTurnApplyPrefix
            ).count()
            const evidence = await completionPromise
            recordWorkbenchAiEvidence(runtime, evidence, 0.8)
            const afterApply = await fs.readFile(targetPath, 'utf-8')
            const applyEntry = await waitForApplyEntry(page)
            await applyEntry.click()
            const diffViewer = getWorkbenchLocator(page, workbenchSelectors.textDiffViewer)
            await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
            const removedLines = diffViewer.locator('[data-diff-line-type="remove"]')
            const addedLines = diffViewer.locator('[data-diff-line-type="add"]')
            await removedLines.first().waitFor({ state: 'visible' })
            await addedLines.first().waitFor({ state: 'visible' })
            const diffText = ((await diffViewer.textContent()) || '').trim()
            const editMode = (
              (await getWorkbenchLocator(
                page,
                workbenchSelectors.documentPreviewModeTag
              ).textContent()) || ''
            ).trim()
            const hasOldLineNumber = await removedLines
              .first()
              .getAttribute('data-old-line')
              .then((value) => Boolean(value))
            const hasNewLineNumber = await addedLines
              .first()
              .getAttribute('data-new-line')
              .then((value) => Boolean(value))
            const addedRowColumnCount = await addedLines.first().locator(':scope > span').count()
            const resourceTabCount = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.resourceTabPrefix
            ).count()
            const standaloneArtifactCount = await getWorkbenchPrefixLocator(
              page,
              workbenchSelectors.assistantTurnArtifactPrefix
            ).count()
            const omittedLineLabels = await diffViewer
              .locator('[data-diff-omitted-count]')
              .allTextContents()

            await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
            await waitForWorkbenchApplyRecordStatus(page, 'reverted')
            const afterRevertBytes = await fs.readFile(targetPath)
            const diffStillVisible = await diffViewer.isVisible().catch(() => false)

            return {
              normalPreviewMode,
              editMode,
              afterApply,
              diffText,
              hasOldLineNumber,
              hasNewLineNumber,
              addedRowColumnCount,
              resourceTabCount,
              standaloneArtifactCount,
              omittedLineLabels,
              applyEntryCountDuringRun,
              restoredBytes: afterRevertBytes.equals(beforeBytes),
              diffStillVisible
            }
          } finally {
            await setup.workspace.cleanup()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.normalPreviewMode === '预览' &&
              result.editMode === '编辑' &&
              result.afterApply.includes('DiffPreview') &&
              result.afterApply.includes('cedar-text-diff-884') &&
              result.diffText.includes('Preview') &&
              result.diffText.includes('DiffPreview') &&
              result.hasOldLineNumber &&
              result.hasNewLineNumber &&
              result.addedRowColumnCount === 3 &&
              result.resourceTabCount === 1 &&
              result.standaloneArtifactCount === 0 &&
              result.applyEntryCountDuringRun === 0 &&
              result.omittedLineLabels.some((label) => label.includes('行未修改')) &&
              result.restoredBytes &&
              result.diffStillVisible,
            {
              name: 'workbench-text-file-preview-diff-revert-real',
              message: '普通预览应继续渲染 Markdown，修改入口应展示文本 diff，并能恢复原始 bytes。',
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
