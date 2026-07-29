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
        serviceMode: 'real',
        execution: 'live',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID
          })
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
          const normalPreviewModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()

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
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          const documentModeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const initialToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const initialModeTag = (await documentModeTag.textContent())?.trim()
          await documentModeToggle.click()
          await getWorkbenchLocator(page, workbenchSelectors.markdownViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          const fileModeToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const previewModeTag = (await documentModeTag.textContent())?.trim()
          await documentModeToggle.click()
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const restoredToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const restoredModeTag = (await documentModeTag.textContent())?.trim()
          const removedLines = diffViewer.locator('[data-diff-line-type="remove"]')
          const addedLines = diffViewer.locator('[data-diff-line-type="add"]')
          await removedLines.first().waitFor({ state: 'visible' })
          await addedLines.first().waitFor({ state: 'visible' })
          const diffText = ((await diffViewer.textContent()) || '').trim()
          const editModeTagCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeTag
          ).count()
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
          const omittedCountBeforeExpand = omittedLineLabels.length
          if (omittedCountBeforeExpand > 0) {
            await diffViewer.locator('[data-diff-omitted-count]').first().click()
            await page.waitForFunction(
              (beforeCount) =>
                document.querySelectorAll('[data-diff-omitted-count]').length < beforeCount,
              omittedCountBeforeExpand
            )
          }
          const omittedCountAfterExpand = await diffViewer
            .locator('[data-diff-omitted-count]')
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
          )
          await currentSessionChanges.first().waitFor({ state: 'visible', timeout: 10_000 })
          const currentSessionChangeMarkerCount = await currentSessionChanges.count()
          await documentModeToggle.click()
          await getWorkbenchLocator(page, workbenchSelectors.markdownViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          const modeBeforeLatestGroupClick = (await documentModeTag.textContent())?.trim()
          await currentSessionChanges.first().click()
          await diffViewer.waitFor({ state: 'visible', timeout: 30_000 })
          const modeAfterLatestGroupClick = (await documentModeTag.textContent())?.trim()
          const latestGroupClickClosedExplorer =
            (await getWorkbenchLocator(
              page,
              workbenchSelectors.workspaceExplorerOverlay
            ).count()) === 0

          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          const afterRevertBytes = await fs.readFile(targetPath)
          const fileStillVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.markdownViewer
          )
            .isVisible()
            .catch(() => false)

          return {
            normalPreviewModeTagCount,
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
            applyEntryCountDuringRun,
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
            latestGroupClickClosedExplorer,
            restoredBytes: afterRevertBytes.equals(beforeBytes),
            fileStillVisible
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.normalPreviewModeTagCount === 0 &&
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
              result.addedRowColumnCount === 3 &&
              result.resourceTabCount === 1 &&
              result.standaloneArtifactCount === 0 &&
              result.applyEntryCountDuringRun === 0 &&
              result.omittedLineLabels.some((label) => label.includes('行未修改')) &&
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
              result.workspaceExplorerModeTextAfterOpen.includes('本会话改动') &&
              result.currentSessionChangeMarkerCount >= 1 &&
              result.modeBeforeLatestGroupClick === '预览' &&
              result.modeAfterLatestGroupClick === '审核' &&
              result.latestGroupClickClosedExplorer &&
              result.restoredBytes &&
              result.fileStillVisible,
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
