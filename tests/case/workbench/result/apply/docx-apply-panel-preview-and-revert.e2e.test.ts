import { assertEmptyDocxOverview } from '../../../../harness/e2e/docxOverview'
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

const CASE_ID = 'docx-apply-panel-preview-and-revert'
const MARKER = 'cedar-apply-731'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'

describe('workbench result e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['apply'],
        description: '真实 AI 修改真实 docx 后，验证 assistant 修改入口、右侧预览和干净回退。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        extraEnv: {
          NCURATOR_E2E_OPEN_WITH_NOOP: '1'
        },
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
            `请直接修改我刚选中的 sample-edit.docx，在文末新增一段：“Workbench apply marker ${MARKER}”。完成后告诉我已写回。`
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
          const applyEntry = await waitForApplyEntry(page)
          const applyEntryText = ((await applyEntry.textContent()) || '').trim()
          const modificationCountsVisibleBeforeClick = /[+-][1-9]\d*/u.test(applyEntryText)
          const applyEntryLines = await applyEntry.evaluate((element) =>
            element instanceof HTMLElement
              ? element.innerText
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
              : []
          )
          const artifactChipCount = await getWorkbenchLocator(page, workbenchSelectors.page)
            .locator(`[data-testid^="${workbenchSelectors.assistantTurnArtifactPrefix}-"]`)
            .count()
          await applyEntry.click()
          await getWorkbenchLocator(page, workbenchSelectors.applyPanel).waitFor({
            state: 'visible'
          })
          await getWorkbenchLocator(page, workbenchSelectors.docxViewer).waitFor({
            state: 'visible',
            timeout: 30_000
          })
          await getWorkbenchLocator(page, workbenchSelectors.applyPanel)
            .getByText(MARKER)
            .waitFor({ state: 'visible', timeout: 30_000 })
          await getWorkbenchLocator(page, workbenchSelectors.applyOpenSystemButton).click()
          const docxOpenWithApplication = page
            .locator(`[data-testid^="${workbenchSelectors.openWithApplicationPrefix}-"]`)
            .first()
          await docxOpenWithApplication.waitFor({ state: 'visible', timeout: 10_000 })
          await docxOpenWithApplication.click()
          const externalApplicationHintVisible = await page
            .getByText(EXTERNAL_APPLICATION_NOTICE, { exact: true })
            .waitFor({ state: 'visible', timeout: 10_000 })
            .then(() => true)
            .catch(() => false)
          const applyPanelText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()
          const documentModeToggle = getWorkbenchLocator(
            page,
            workbenchSelectors.documentModeToggle
          )
          const documentModeTag = getWorkbenchLocator(page, workbenchSelectors.documentModeTag)
          const initialToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const initialModeTag = (await documentModeTag.textContent())?.trim()
          await documentModeToggle.click()
          await assertEmptyDocxOverview(runtime)
          const fileModeToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const previewModeTag = (await documentModeTag.textContent())?.trim()
          const previewToolbarText = (
            await getWorkbenchLocator(page, workbenchSelectors.documentToolbar).textContent()
          )?.trim()
          const previewRevertButtonCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyRevertButton
          ).count()
          await documentModeToggle.click()
          const restoredToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const restoredModeTag = (await documentModeTag.textContent())?.trim()
          const openSystemButtonVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyOpenSystemButton
          )
            .isVisible()
            .catch(() => false)
          const documentToolbar = getWorkbenchLocator(page, workbenchSelectors.documentToolbar)
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
          const revertButtonVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyRevertButton
          )
            .isVisible()
            .catch(() => false)
          const documentViewVisible = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentView
          )
            .evaluate(
              (element) =>
                element instanceof HTMLElement &&
                element.offsetWidth > 0 &&
                element.offsetHeight > 0 &&
                element.getClientRects().length > 0
            )
            .catch(() => false)
          const documentViewNoHorizontalOverflow = await getWorkbenchLocator(
            page,
            workbenchSelectors.documentView
          )
            .evaluate((element) => {
              if (!(element instanceof HTMLElement)) return false
              return element.scrollWidth <= element.clientWidth + 1
            })
            .catch(() => false)
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertButton).click()
          await page.getByText('回退这次修改？').waitFor({ state: 'visible' })
          await getWorkbenchLocator(page, workbenchSelectors.applyRevertConfirmButton).click()
          await waitForWorkbenchApplyRecordStatus(page, 'reverted')
          await documentModeTag.getByText('预览', { exact: true }).waitFor({ state: 'visible' })
          await assertEmptyDocxOverview(runtime)
          const revertedModeTag = (await documentModeTag.textContent())?.trim()
          const revertedToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const revertedRevertButtonCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyRevertButton
          ).count()
          const afterRevertText = await readDocxPlainText(targetPath)
          const revertedPanelText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()

          return {
            beforeText,
            afterApplyText,
            afterRevertText,
            applyEntryText,
            applyEntryLines,
            modificationCountsVisibleBeforeClick,
            artifactChipCount,
            applyPanelText,
            externalApplicationHintVisible,
            initialToggleLabel,
            fileModeToggleLabel,
            restoredToggleLabel,
            initialModeTag,
            previewModeTag,
            previewToolbarText,
            previewRevertButtonCount,
            restoredModeTag,
            revertedModeTag,
            revertedToggleLabel,
            revertedRevertButtonCount,
            openSystemButtonVisible,
            standaloneRevealButtonCount,
            revealMenuItemVisible,
            revertButtonVisible,
            revertedPanelText,
            documentViewVisible,
            documentViewNoHorizontalOverflow,
            fileArtifactCount: evidence.events.filter((event) => event.type === 'file_artifact')
              .length
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            !result.beforeText.includes(MARKER) &&
              result.afterApplyText.includes(MARKER) &&
              result.afterRevertText === result.beforeText &&
              result.applyEntryText.includes('sample-edit.docx') &&
              result.modificationCountsVisibleBeforeClick &&
              result.applyEntryLines.filter((line) => line.includes('sample-edit.docx')).length ===
                1 &&
              !result.applyEntryText.includes('已修改') &&
              result.artifactChipCount === 0 &&
              result.initialModeTag === '审核' &&
              result.previewModeTag === '预览' &&
              !result.previewToolbarText?.includes('+') &&
              !result.previewToolbarText?.includes('已回退') &&
              !result.previewToolbarText?.includes('已删除') &&
              result.previewRevertButtonCount === 0 &&
              result.restoredModeTag === '审核' &&
              result.revertedModeTag === '预览' &&
              result.revertedToggleLabel === '切换到审核模式' &&
              result.revertedRevertButtonCount === 0 &&
              !result.applyPanelText.includes('已修改') &&
              !result.applyPanelText.includes('其他应用') &&
              !result.applyPanelText.includes('处修改') &&
              !result.applyPanelText.includes('最新改动') &&
              !result.applyPanelText.includes('修改前') &&
              !result.applyPanelText.includes('修改后') &&
              result.initialToggleLabel === '切换到预览模式' &&
              result.fileModeToggleLabel === '切换到审核模式' &&
              result.restoredToggleLabel === '切换到预览模式' &&
              result.openSystemButtonVisible &&
              result.standaloneRevealButtonCount === 0 &&
              result.revealMenuItemVisible &&
              result.revertButtonVisible &&
              !result.revertedPanelText.includes('已回退') &&
              !result.revertedPanelText.includes('已删除') &&
              result.applyPanelText.includes(MARKER) &&
              result.externalApplicationHintVisible &&
              result.documentViewVisible &&
              result.documentViewNoHorizontalOverflow &&
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
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
