import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createWorkbenchNewSession,
  getWorkbenchLocator,
  getWorkbenchPrefixLocator,
  insertWorkbenchReferenceToken,
  openWorkbenchWorkspaceFile,
  recordWorkbenchAiEvidence,
  sendWorkbenchMessage,
  setupWorkbenchWithTempWorkspace,
  waitForApplyEntryByFileName,
  waitForWorkbenchAiRunCompletion,
  waitForWorkbenchAiEvent,
  waitForWorkbenchApplyRecordStatus,
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
        description: '验证 Markdown 打开即编辑态、文本修改 diff 展示和按原始 bytes 回退。',
        fixtures: ['tests/fixtures/workspace'],
        knowledge: 'cached',
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
          const targetPath = path.join(setup.workspace.rootPath, 'workbench-preview.md')
          await fs.appendFile(
            targetPath,
            '\n' + Array.from({ length: 40 }, (_, i) => `Unchanged context ${i}`).join('\n') + '\n'
          )
          const beforeBytes = await fs.readFile(targetPath)

          await createWorkbenchNewSession(page)
          await openWorkbenchWorkspaceFile(runtime, 'workbench-preview.md')
          await getWorkbenchLocator(page, workbenchSelectors.markdownEditor).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          const normalPreviewModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()
          const originalDocumentView = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentView
          ).elementHandle()
          await page.evaluate((noticeText) => {
            const target = window as unknown as {
              __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number
              __NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?: MutationObserver
            }
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ = 0
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__?.disconnect()
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__ = new MutationObserver(
              (mutations) => {
                if (
                  mutations.some((mutation) =>
                    [...mutation.addedNodes].some((node) => node.textContent?.includes(noticeText))
                  )
                ) {
                  target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ =
                    (target.__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0) + 1
                }
              }
            )
            target.__NCURATOR_TEST_EXTERNAL_NOTICE_OBSERVER__.observe(document.body, {
              childList: true,
              subtree: true
            })
          }, '检测到当前文件被外部修改，已自动刷新')

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
            name: 'text_file_saved_before_run_completion',
            matches: (event) =>
              event.type === 'tool_call_result' &&
              event.toolName === 'text_file_edit' &&
              event.result?.ok === true
          })
          const applyEntryCountDuringRun = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnApplyPrefix
          ).count()
          const evidence = await completionPromise
          recordWorkbenchAiEvidence(runtime, evidence, 0.8)
          await getWorkbenchLocator(page, workbenchSelectors.documentModeToggle).waitFor({
            state: 'visible',
            timeout: 15_000
          })
          const associatedPreviewMode = (
            await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()
          )?.trim()
          const documentViewPreserved = await originalDocumentView?.evaluate(
            (element) => element.isConnected
          )
          const applyEntry = await waitForApplyEntryByFileName(page, 'workbench-preview.md')
          const assistantApplyTextBeforeClick = ((await applyEntry.textContent()) || '').trim()
          const modificationCountsVisibleBeforeClick = /[+-][1-9]\d*/u.test(
            assistantApplyTextBeforeClick
          )
          const afterApply = await fs.readFile(targetPath, 'utf-8')
          if (!afterApply.includes('cedar-text-diff-884')) {
            throw new Error(
              'AI write did not persist cedar-text-diff-884 into workbench-preview.md'
            )
          }
          // Prefer opening apply first — the AI session may not already show the markdown editor.
          const normalPreviewAfterAiWrite = getWorkbenchLocator(
            page,
            workbenchSelectors.markdownEditor
          )
          const previewVisibleBeforeSwitch = await normalPreviewAfterAiWrite
            .getByText('cedar-text-diff-884')
            .waitFor({ state: 'visible', timeout: 3_000 })
            .then(() => true)
            .catch(() => false)
          if (!previewVisibleBeforeSwitch) {
            await applyEntry.click()
            const diffViewer = getWorkbenchLocator(page, workbenchSelectors.textDiffViewer)
            await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
            const diffHasToken = await diffViewer
              .getByText('cedar-text-diff-884')
              .waitFor({ state: 'visible', timeout: 15_000 })
              .then(() => true)
              .catch(() => false)
            if (!diffHasToken) {
              const modeToggle = getWorkbenchLocator(page, workbenchSelectors.documentModeToggle)
              if (await modeToggle.isVisible().catch(() => false)) {
                await modeToggle.click()
              }
              await normalPreviewAfterAiWrite
                .getByText('cedar-text-diff-884')
                .waitFor({ state: 'visible', timeout: 30_000 })
            }
          }
          const aiWritePreviewRefreshedSilently =
            previewVisibleBeforeSwitch &&
            (await page.evaluate(
              () =>
                (window as unknown as { __NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__?: number })
                  .__NCURATOR_TEST_EXTERNAL_NOTICE_COUNT__ || 0
            )) === 0
          await openWorkbenchWorkspaceFile(runtime, 'workbench-preview.md')
          const allFilePreviewMode = (
            await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()
          )?.trim()
          await getWorkbenchLocator(page, workbenchSelectors.documentModeToggle).click()
          await getWorkbenchLocator(page, workbenchSelectors.textDiffViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          const allFileCanReview =
            (
              await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()
            )?.trim() === '审核'
          const followUpStartedAt = Date.now()
          await sendWorkbenchMessage(page, '只解释刚才文字修改的用途，简短回答即可。无需修改文件。')
          await waitForWorkbenchAiRunCompletion(
            runtime,
            followUpStartedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          const pinnedReviewPreserved =
            (await getWorkbenchLocator(page, workbenchSelectors.textDiffViewer).isVisible()) &&
            (
              await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()
            )?.trim() === '审核'
          const runStartedEvent = evidence.events.find(
            (
              item
            ): item is Extract<
              import('../../../../../src/shared/types').AiRunEvent,
              { type: 'run_started' }
            > => item.type === 'run_started'
          )
          if (!runStartedEvent) throw new Error('run_started event is missing')
          await createWorkbenchNewSession(page)
          await getWorkbenchLocator(
            page,
            `${workbenchSelectors.partnerItemPrefix}-${runStartedEvent.partnerId}`
          ).click()
          const restoredApplyEntry = await waitForApplyEntryByFileName(page, 'workbench-preview.md')
          const assistantApplyTextAfterSessionSwitch = (
            (await restoredApplyEntry.textContent()) || ''
          ).trim()
          const modificationCountsVisibleAfterSessionSwitch = /[+-][1-9]\d*/u.test(
            assistantApplyTextAfterSessionSwitch
          )
          await restoredApplyEntry.click()
          const diffViewer = getWorkbenchLocator(page, workbenchSelectors.textDiffViewer)
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          const documentModeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const initialToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const initialModeTag = (await documentModeTag.textContent())?.trim()
          await fs.writeFile(targetPath, afterApply + '\nEXTERNAL_TEXT_C\n')
          await documentModeToggle.click()
          await page
            .locator(
              `[data-testid="${workbenchSelectors.markdownEditor}"], [data-testid="${workbenchSelectors.markdownViewer}"]`
            )
            .first()
            .waitFor({
              state: 'visible',
              timeout: 30_000
            })
          const fileModeToggleLabel = await documentModeToggle.getAttribute('aria-label')
          await page
            .getByText('EXTERNAL_TEXT_C', { exact: false })
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 })
          const previewContainsExternalC = true
          const previewModeTag = (await documentModeTag.textContent())?.trim()
          await restoredApplyEntry.click()
          await documentModeTag.getByText('审核', { exact: true }).waitFor()
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const restoredToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const restoredModeTag = (await documentModeTag.textContent())?.trim()
          const removedLines = diffViewer.locator('.editor.original .view-line')
          const addedLines = diffViewer.locator('.editor.modified .view-line')
          await removedLines.first().waitFor({ state: 'visible' })
          await addedLines.first().waitFor({ state: 'visible' })
          const diffText = ((await diffViewer.textContent()) || '').trim()
          const editModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()
          const hasOldLineNumber =
            (await diffViewer.locator('.editor.original .line-numbers').count()) > 0
          const hasNewLineNumber =
            (await diffViewer.locator('.editor.modified .line-numbers').count()) > 0
          const addedRowColumnCount = await diffViewer.locator('.monaco-diff-editor').count()
          await addedLines.last().click()
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End')
          await page.keyboard.insertText('\nREVIEW_MANUAL_C')
          let reviewEditSaved = false
          for (let i = 0; i < 100; i++) {
            if ((await fs.readFile(targetPath, 'utf8')).includes('REVIEW_MANUAL_C')) {
              reviewEditSaved = true
              break
            }
            await page.waitForTimeout(100)
          }
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
          let reviewUndoSaved = false
          for (let i = 0; i < 100; i++) {
            if (!(await fs.readFile(targetPath, 'utf8')).includes('REVIEW_MANUAL_C')) {
              reviewUndoSaved = true
              break
            }
            await page.waitForTimeout(100)
          }
          const resourceTabCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.resourceTabPrefix
          ).count()
          const standaloneArtifactCount = await getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.assistantTurnArtifactPrefix
          ).count()
          const reviewToolbar = diffViewer.getByRole('toolbar', { name: '文本审核' })
          const editableTitleVisible = await reviewToolbar
            .getByText('当前文件（可编辑）', { exact: true })
            .isVisible()
          const compactReviewToolbar = await reviewToolbar.evaluate(
            (element) =>
              element.getBoundingClientRect().height <= 36 &&
              element.querySelectorAll('button').length === 3
          )
          const previousDiff = reviewToolbar.getByRole('button', {
            name: '上一处差异',
            exact: true
          })
          const nextDiff = reviewToolbar.getByRole('button', { name: '下一处差异', exact: true })
          await previousDiff.click()
          await nextDiff.click()
          const omittedLineLabels = await diffViewer
            .locator('.unchanged-lines-label')
            .allTextContents()
          const foldedLabelsLocalized =
            omittedLineLabels.length > 0 &&
            omittedLineLabels.every((label) => /^已折叠 \d+ 行$/.test(label.trim()))
          const foldedLabels = diffViewer.getByRole('button', { name: /^已折叠 \d+ 行$/ })
          await runtime.captureScreenshot({
            name: 'compact-text-review',
            message: '单行审核工具栏与中文折叠条'
          })
          await foldedLabels.last().click()
          const oneRegionExpanded =
            (await diffViewer.locator('.unchanged-lines-label').count()) < omittedLineLabels.length
          const omittedCountBeforeExpand = omittedLineLabels.length
          await diffViewer.getByRole('button', { name: '展开未修改内容', exact: true }).click()
          await page.waitForFunction(
            () => document.querySelectorAll('.diff-hidden-lines-widget').length === 0
          )
          const omittedCountAfterExpand = await diffViewer
            .locator('.diff-hidden-lines-widget')
            .count()
          const workspaceExplorerToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerToggle
          )
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.getAttribute('aria-label') ===
              '展开文件列表',
            workbenchSelectors.workspaceExplorerToggle
          )
          const workspaceExplorerToggleLabelBeforeOpen =
            await workspaceExplorerToggle.getAttribute('aria-label')
          const workspaceExplorerToggleIcon =
            await workspaceExplorerToggle.getAttribute('data-icon')
          const documentToolbar = getWorkbenchLocator(page, workbenchSelectors.documentToolbar)
          const documentView = getWorkbenchLocator(page, workbenchSelectors.documentView)
          const documentViewWidthBeforeExplorer = await documentView.evaluate(
            (element) => element.getBoundingClientRect().width
          )
          const standaloneRevealButtonCount = await documentToolbar
            .getByRole('button', { name: '定位文件' })
            .count()
          await page.mouse.move(0, 0)
          await page
            .getByRole('tooltip')
            .filter({ hasText: '折叠未修改内容' })
            .waitFor({ state: 'hidden' })
          await getWorkbenchLocator(page, workbenchSelectors.openWithMenu)
            .getByRole('button', { name: '选择打开应用' })
            .click()
          const revealMenuItemVisible = await page
            .getByRole('menuitem', { name: '打开所在文件夹' })
            .last()
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          await page.keyboard.press('Escape')
          await getWorkbenchLocator(page, workbenchSelectors.openWithButton).click()
          const externalApplicationHintVisible = await page
            .getByText('如果外部应用仍显示旧内容，请关闭该文档后重新打开。', {
              exact: true
            })
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          const toolbarActionOrder = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentToolbar
          ).evaluate(
            (toolbar, selectors) =>
              selectors
                .map((testId) => toolbar.querySelector(`[data-testid="${testId}"]`))
                .filter((element): element is Element => Boolean(element))
                .map((element) => ({
                  testId: element.getAttribute('data-testid'),
                  left: element.getBoundingClientRect().left
                }))
                .sort((left, right) => left.left - right.left)
                .map((item) => item.testId),
            [
              workbenchSelectors.openWithMenu,
              workbenchSelectors.documentModeToggle,
              workbenchSelectors.applyRevertButton,
              workbenchSelectors.workspaceExplorerToggle
            ]
          )
          const workspaceExplorerModeCountBeforeOpen = await getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerModeSwitch
          ).count()
          await workspaceExplorerToggle.click()
          const workspaceExplorerOverlay = getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerOverlay
          )
          await workspaceExplorerOverlay.waitFor({ state: 'visible' })
          const [toolbarBox, explorerBox] = await Promise.all([
            documentToolbar.boundingBox(),
            workspaceExplorerOverlay.boundingBox()
          ])
          const documentViewWidthAfterExplorer = await documentView.evaluate(
            (element) => element.getBoundingClientRect().width
          )
          const explorerFloatsBelowToolbar = Boolean(
            toolbarBox &&
            explorerBox &&
            Math.abs(explorerBox.y - (toolbarBox.y + toolbarBox.height)) <= 1
          )
          const explorerDoesNotResizePreview =
            Math.abs(documentViewWidthAfterExplorer - documentViewWidthBeforeExplorer) <= 1
          const workspaceExplorerBackdrop = getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerBackdrop
          )
          const explorerBackdropVisible = await workspaceExplorerBackdrop.isVisible()
          await workspaceExplorerBackdrop.click({ position: { x: 5, y: 5 } })
          await workspaceExplorerOverlay.waitFor({ state: 'hidden' })
          const explorerClosedByOutsideClick =
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).count()) === 0
          await workspaceExplorerToggle.click()
          await workspaceExplorerOverlay.waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await workspaceExplorerOverlay.waitFor({ state: 'hidden' })
          const explorerClosedByEscape =
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).count()) === 0
          await workspaceExplorerToggle.click()
          const workspaceExplorerModeSwitch = getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerModeSwitch
          )
          await workspaceExplorerModeSwitch.waitFor({ state: 'visible' })
          const workspaceExplorerToggleLabelAfterOpen =
            await workspaceExplorerToggle.getAttribute('aria-label')
          const workspaceExplorerTogglePressedAfterOpen =
            await workspaceExplorerToggle.getAttribute('aria-pressed')
          const workspaceExplorerToggleClassAfterOpen =
            (await workspaceExplorerToggle.getAttribute('class')) || ''
          const workspaceExplorerModeTextAfterOpen =
            (await workspaceExplorerModeSwitch.textContent()) || ''
          const currentSessionChanges = getWorkbenchPrefixLocator(
            page,
            workbenchSelectors.workspaceFileChangePrefix
          ).filter({ hasText: 'workbench-preview.md' })
          await currentSessionChanges.first().waitFor({ state: 'visible', timeout: 10_000 })
          const currentSessionChangeMarkerCount = await currentSessionChanges.count()
          await documentModeToggle.click()
          await page
            .locator(
              `[data-testid="${workbenchSelectors.markdownEditor}"], [data-testid="${workbenchSelectors.markdownViewer}"]`
            )
            .first()
            .waitFor({
              state: 'visible',
              timeout: 30_000
            })
          const modeBeforeLatestGroupClick = (await documentModeTag.textContent())?.trim()
          await currentSessionChanges.first().click()
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const modeAfterLatestGroupClick = (await documentModeTag.textContent())?.trim()
          const latestGroupClickPreservedExplorer = await getWorkbenchLocator(
            page,
            workbenchSelectors.workspaceExplorerOverlay
          ).isVisible()

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await page.getByText('仍然回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const afterRevertBytes = await fs.readFile(targetPath)
          const fileStillVisible = await page
            .locator(
              `[data-testid="${workbenchSelectors.markdownEditor}"], [data-testid="${workbenchSelectors.markdownViewer}"]`
            )
            .first()
            .isVisible()
            .catch(() => false)

          return {
            previewContainsExternalC,
            normalPreviewModeTagCount,
            associatedPreviewMode,
            documentViewPreserved,
            allFilePreviewMode,
            allFileCanReview,
            pinnedReviewPreserved,
            editModeTagCount,
            initialToggleLabel,
            fileModeToggleLabel,
            restoredToggleLabel,
            initialModeTag,
            previewModeTag,
            restoredModeTag,
            afterApply,
            diffText,
            hasOldLineNumber,
            hasNewLineNumber,
            addedRowColumnCount,
            resourceTabCount,
            standaloneArtifactCount,
            omittedLineLabels,
            compactReviewToolbar,
            editableTitleVisible,
            foldedLabelsLocalized,
            oneRegionExpanded,
            applyEntryCountDuringRun,
            modificationCountsVisibleBeforeClick,
            reviewEditSaved,
            reviewUndoSaved,
            modificationCountsVisibleAfterSessionSwitch,
            assistantApplyTextBeforeClick,
            aiWritePreviewRefreshedSilently,
            externalApplicationHintVisible,
            omittedCountBeforeExpand,
            omittedCountAfterExpand,
            workspaceExplorerToggleLabelBeforeOpen,
            workspaceExplorerToggleIcon,
            workspaceExplorerToggleLabelAfterOpen,
            workspaceExplorerTogglePressedAfterOpen,
            workspaceExplorerToggleClassAfterOpen,
            explorerFloatsBelowToolbar,
            explorerDoesNotResizePreview,
            explorerBackdropVisible,
            explorerClosedByOutsideClick,
            explorerClosedByEscape,
            standaloneRevealButtonCount,
            revealMenuItemVisible,
            toolbarActionOrder,
            workspaceExplorerModeCountBeforeOpen,
            workspaceExplorerModeTextAfterOpen,
            currentSessionChangeMarkerCount,
            modeBeforeLatestGroupClick,
            modeAfterLatestGroupClick,
            latestGroupClickPreservedExplorer,
            restoredBytes: afterRevertBytes.equals(beforeBytes),
            fileStillVisible
          }
        },
        assert: async (result, runtime) => {
          const modelDisposalErrors = (await runtime.collectSignals()).consoleEntries
            .filter((entry) =>
              entry.text.includes('TextModel got disposed before DiffEditorWidget model got reset')
            )
            .map((entry) => entry.text.split('\n')[0])
          await runtime.assertThat(modelDisposalErrors.length === 0, {
            name: 'workbench-text-review-model-lifecycle',
            message: '审核切换、伙伴恢复和回退期间不应出现 Monaco 模型提前释放异常。',
            data: modelDisposalErrors
          })
          await runtime.assertThat(
            result.previewContainsExternalC &&
              result.diffText.includes('EXTERNAL_TEXT_C') &&
              result.reviewEditSaved &&
              result.reviewUndoSaved &&
              result.normalPreviewModeTagCount === 0 &&
              result.associatedPreviewMode === '预览' &&
              result.documentViewPreserved &&
              result.allFilePreviewMode === '预览' &&
              result.allFileCanReview &&
              result.pinnedReviewPreserved &&
              result.editModeTagCount === 1 &&
              result.initialModeTag === '审核' &&
              result.previewModeTag === '预览' &&
              result.restoredModeTag === '审核' &&
              result.initialToggleLabel === '切换到预览模式' &&
              result.fileModeToggleLabel === '切换到审核模式' &&
              result.restoredToggleLabel === '切换到预览模式' &&
              result.afterApply.includes('DiffPreview') &&
              result.afterApply.includes('cedar-text-diff-884') &&
              result.diffText.includes('Preview') &&
              result.diffText.includes('DiffPreview') &&
              result.hasOldLineNumber &&
              result.hasNewLineNumber &&
              result.addedRowColumnCount === 1 &&
              result.resourceTabCount === 1 &&
              result.standaloneArtifactCount === 0 &&
              result.applyEntryCountDuringRun === 0 &&
              result.modificationCountsVisibleBeforeClick &&
              result.modificationCountsVisibleAfterSessionSwitch &&
              result.externalApplicationHintVisible &&
              result.omittedLineLabels.length > 0 &&
              result.compactReviewToolbar &&
              result.editableTitleVisible &&
              result.foldedLabelsLocalized &&
              result.oneRegionExpanded &&
              result.omittedCountAfterExpand < result.omittedCountBeforeExpand &&
              result.workspaceExplorerToggleLabelBeforeOpen === '展开文件列表' &&
              result.workspaceExplorerToggleIcon === 'folder' &&
              result.workspaceExplorerToggleLabelAfterOpen === '收起文件列表' &&
              result.workspaceExplorerTogglePressedAfterOpen === 'true' &&
              result.workspaceExplorerToggleClassAfterOpen.includes('!bg-[#F1F1EF]') &&
              result.explorerFloatsBelowToolbar &&
              result.explorerDoesNotResizePreview &&
              result.explorerBackdropVisible &&
              result.explorerClosedByOutsideClick &&
              result.explorerClosedByEscape &&
              result.standaloneRevealButtonCount === 0 &&
              result.revealMenuItemVisible &&
              JSON.stringify(result.toolbarActionOrder) ===
                JSON.stringify([
                  workbenchSelectors.documentModeToggle,
                  workbenchSelectors.openWithMenu,
                  workbenchSelectors.applyRevertButton,
                  workbenchSelectors.workspaceExplorerToggle
                ]) &&
              result.workspaceExplorerModeCountBeforeOpen === 0 &&
              result.workspaceExplorerModeTextAfterOpen.includes('本次运行改动') &&
              result.currentSessionChangeMarkerCount >= 1 &&
              result.modeBeforeLatestGroupClick === '预览' &&
              result.modeAfterLatestGroupClick === '审核' &&
              result.latestGroupClickPreservedExplorer &&
              result.restoredBytes &&
              result.fileStillVisible,
            {
              name: 'workbench-text-file-preview-diff-revert-real',
              message:
                'Markdown 打开即编辑态并展示最新内容；AI 运行完成后修改入口在未点击时已显示非零修改数量，切换会话再切回后不点击仍保持真实数量，点击后展示文本 diff，并能恢复原始 bytes。',
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
