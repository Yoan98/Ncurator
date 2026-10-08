import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import path from 'node:path'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { XMLSerializer } from '@xmldom/xmldom'
import { readReviewPart } from '../../../../harness/backend/docxReviewAssertions'
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

const CASE_ID = 'docx-review-position-and-inline-diff'
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
          await writeTestDocxFile(setup.workspace.rootPath, 'sample-edit.docx', [
            { type: 'paragraph', text: '标题' },
            { type: 'paragraph', text: '日期' },
            { type: 'paragraph', text: '本周结论：二期尾款126万元，需重点跟进。' },
            { type: 'paragraph', text: '三、风险与问题' },
            { type: 'paragraph', text: '风险段落：客户验收延期。' },
            { type: 'paragraph', text: '其他内容保持不变。' }
          ])
          const initial = await fs.readFile(targetPath),
            zip = await JSZip.loadAsync(initial),
            doc = await readReviewPart(initial)
          const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
          const run = Array.from(doc.getElementsByTagNameNS(W, 't')).find(
            (t) => t.textContent === '其他内容保持不变。'
          )!.parentNode as Element
          const props = doc.createElementNS(W, 'w:rPr'),
            color = doc.createElementNS(W, 'w:color'),
            shade = doc.createElementNS(W, 'w:shd')
          color.setAttributeNS(W, 'w:val', '223344')
          shade.setAttributeNS(W, 'w:fill', 'FFFF00')
          props.appendChild(color)
          props.appendChild(shade)
          run.insertBefore(props, run.firstChild)
          zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
          await fs.writeFile(targetPath, await zip.generateAsync({ type: 'nodebuffer' }))
          const beforeBytes = await fs.readFile(targetPath)
          const beforeText = await readDocxPlainText(targetPath)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改我刚选中的 sample-edit.docx，将完整的“风险段落：客户验收延期。”移到“日期”之后、“本周结论”之前；将本周结论中的126改为128；将“重点跟进”加粗；另将“其他内容”四个字加粗，保留该段已有字体颜色和黄色底色；其余文字与格式保留。在文末新增一段：“Workbench apply marker ${MARKER}”。完成后告诉我已写回。`
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
          const reviewVisual = await getWorkbenchLocator(
            page,
            workbenchSelectors.docxViewer
          ).evaluate((element) => {
            const paragraphs = Array.from(element.querySelectorAll('p')).map((p) => {
              const fragments: Array<{
                text: string
                color: string
                background: string
                decoration: string
                weight: string
                border: string
              }> = []
              const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT)
              while (walker.nextNode()) {
                const node = walker.currentNode,
                  parent = node.parentElement
                if (!parent || !node.textContent) continue
                const style = getComputedStyle(parent)
                let background = style.backgroundColor
                for (
                  let ancestor = parent.parentElement;
                  ['transparent', 'rgba(0, 0, 0, 0)'].includes(background) &&
                  ancestor &&
                  ancestor !== p.parentElement;
                  ancestor = ancestor.parentElement
                )
                  background = getComputedStyle(ancestor).backgroundColor
                fragments.push({
                  text: node.textContent,
                  color: style.color,
                  background,
                  decoration: style.textDecorationLine,
                  weight: style.fontWeight,
                  border: style.borderTopColor
                })
              }
              return { text: p.textContent || '', fragments }
            })
            return paragraphs
          })
          runtime.assertThat(
            reviewVisual.filter((p) => p.text === '风险段落：客户验收延期。').length === 2 &&
              reviewVisual.findIndex((p) => p.text === '风险段落：客户验收延期。') <
                reviewVisual.findIndex((p) => p.text.startsWith('本周结论')) &&
              reviewVisual.findIndex((p) => p.text === '三、风险与问题') <
                reviewVisual.map((p) => p.text).lastIndexOf('风险段落：客户验收延期。'),
            {
              name: 'review-move-original-and-final-position',
              message: '风险段落绿增在新位置、红删在原位置',
              data: reviewVisual
            }
          )
          const conclusion = reviewVisual.find((p) => p.text.startsWith('本周结论'))!
          runtime.assertThat(
            conclusion.fragments
              .filter((f) => f.color === 'rgb(180, 35, 24)')
              .map((f) => f.text)
              .join('') === '6' &&
              conclusion.fragments
                .filter((f) => f.color === 'rgb(22, 101, 52)')
                .map((f) => f.text)
                .join('') === '8' &&
              conclusion.fragments.some(
                (f) =>
                  f.text === '重点跟进' &&
                  f.background === 'rgb(233, 247, 239)' &&
                  Number(f.weight) >= 600
              ),
            {
              name: 'review-character-and-local-format',
              message: '只显示6→8的逐字红绿差异，“重点跟进”保持加粗并局部标绿',
              data: conclusion
            }
          )
          const colored = reviewVisual.find((p) => p.text === '其他内容保持不变。')!
          runtime.assertThat(
            colored.fragments
              .filter((f) => f.border === 'rgb(22, 101, 52)')
              .map((f) => f.text)
              .join('') === '其他内容' &&
              colored.fragments.every(
                (f) => f.color === 'rgb(34, 51, 68)' && f.background === 'rgb(255, 255, 0)'
              ),
            {
              name: 'review-border-preserves-user-colors',
              message: '已有底色的格式范围只画绿色边框，原始前景色和底色均保留',
              data: colored
            }
          )
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
          const revertedModeTag = (await documentModeTag.textContent())?.trim()
          const revertedToggleLabel = await documentModeToggle.getAttribute('aria-label')
          const revertedRevertButtonCount = await getWorkbenchLocator(
            page,
            workbenchSelectors.applyRevertButton
          ).count()
          const byteRevert = beforeBytes.equals(await fs.readFile(targetPath))
          const afterRevertText = await readDocxPlainText(targetPath)
          const revertedPanelText = (
            (await getWorkbenchLocator(page, workbenchSelectors.applyPanel).textContent()) || ''
          ).trim()

          return {
            byteRevert,
            reviewVisual,
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
              result.byteRevert &&
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
              name: 'workbench-docx-review-position-inline-real',
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
