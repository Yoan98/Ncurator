import {
  assertDocxReviewOverview,
  assertEmptyDocxOverview
} from '../../../../harness/e2e/docxOverview'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import path from 'node:path'
import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { readReviewPart } from '../../../../harness/backend/docxReviewAssertions'
import { createStyleContext } from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/styleResolver'
import { readRunStyle } from '../../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/contentTree'
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
  waitForApplyEntryByFileName,
  waitForWorkbenchApplyRecordStatus,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-review-position-and-inline-diff'
const MARKER = 'cedar-apply-731'
const EXTERNAL_APPLICATION_NOTICE = '如果外部应用仍显示旧内容，请关闭该文档后重新打开。'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const INTRO_PARTS = [
  { text: '本产品是一套面向社区公开资料整理与分享场景的 ', bold: false },
  { text: '公开资料整理工作台', bold: true },
  { text: '，围绕文件归档、资料检索和修改审阅组织工作，支持 ', bold: false },
  { text: '文件归档式、主题检索式、协作校对式', bold: true },
  {
    text: ' 三种工作模式，帮助志愿者按主题维护公开资料，帮助参与者找到可复用内容、核对来源并共同完善文档。',
    bold: false
  }
]
const CORE_NAMES = ['公开资料整理工作台', '文件归档式', '主题检索式', '协作校对式']

const readPositioningParagraph = async (buffer: Buffer) => {
  const doc = await readReviewPart(buffer)
  const styles = createStyleContext(await readReviewPart(buffer, 'word/styles.xml'))
  const paragraph = Array.from(doc.getElementsByTagNameNS(W, 'p')).find((p) =>
    (p.textContent || '').includes(CORE_NAMES[0]!)
  )
  if (!paragraph) throw new Error('产品定位段落不存在')
  const runs = Array.from(paragraph.getElementsByTagNameNS(W, 'r')).map((run) => ({
    text: Array.from(run.getElementsByTagNameNS(W, 't'))
      .map((t) => t.textContent || '')
      .join(''),
    style: readRunStyle(run, styles)
  }))
  const indent = paragraph.getElementsByTagNameNS(W, 'ind')[0]
  return {
    text: runs.map((run) => run.text).join(''),
    boldText: runs
      .filter((run) => run.style?.bold)
      .map((run) => run.text)
      .join(''),
    indent: Object.fromEntries(
      Array.from(indent?.attributes || []).map((attr) => [attr.localName, attr.value])
    ),
    runs
  }
}

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
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const targetPath = path.join(setup.workspace.rootPath, 'sample-edit.docx')
          await writeTestDocxFile(setup.workspace.rootPath, 'sample-edit.docx', [
            { type: 'paragraph', text: '标题' },
            { type: 'paragraph', text: '日期' },
            { type: 'paragraph', text: INTRO_PARTS.map((part) => part.text).join('') },
            { type: 'paragraph', text: '本周结论：二期尾款126万元，需重点跟进。' },
            { type: 'paragraph', text: '三、风险与问题' },
            { type: 'paragraph', text: '风险段落：客户验收延期。' },
            { type: 'paragraph', text: '其他内容保持不变。' }
          ])
          const initial = await fs.readFile(targetPath),
            zip = await JSZip.loadAsync(initial),
            doc = await readReviewPart(initial)
          const intro = Array.from(doc.getElementsByTagNameNS(W, 'p')).find((p) =>
            (p.textContent || '').startsWith('本产品')
          )!
          while (intro.firstChild) intro.removeChild(intro.firstChild)
          const paragraphProps = doc.createElementNS(W, 'w:pPr')
          const indent = doc.createElementNS(W, 'w:ind')
          indent.setAttributeNS(W, 'w:firstLine', '420')
          indent.setAttributeNS(W, 'w:firstLineChars', '0')
          paragraphProps.appendChild(indent)
          intro.appendChild(paragraphProps)
          for (const part of INTRO_PARTS) {
            const run = doc.createElementNS(W, 'w:r')
            const props = doc.createElementNS(W, 'w:rPr')
            if (part.bold) {
              const style = doc.createElementNS(W, 'w:rStyle')
              style.setAttributeNS(W, 'w:val', 'CaseStrongChild')
              props.appendChild(style)
            }
            const fonts = doc.createElementNS(W, 'w:rFonts')
            fonts.setAttributeNS(W, 'w:ascii', '宋体')
            fonts.setAttributeNS(W, 'w:eastAsia', '宋体')
            const size = doc.createElementNS(W, 'w:sz')
            size.setAttributeNS(W, 'w:val', '24')
            props.appendChild(fonts)
            props.appendChild(size)
            const text = doc.createElementNS(W, 'w:t')
            text.setAttribute('xml:space', 'preserve')
            text.appendChild(doc.createTextNode(part.text))
            run.appendChild(props)
            run.appendChild(text)
            intro.appendChild(run)
          }
          const stylesDoc = await readReviewPart(initial, 'word/styles.xml')
          const inherited = new DOMParser().parseFromString(
            `<w:styles xmlns:w="${W}">
            <w:style w:type="character" w:styleId="CaseCharacterBase"><w:name w:val="CaseCharacterBase"/></w:style>
            <w:style w:type="character" w:styleId="CaseStrong"><w:name w:val="CaseStrong"/><w:basedOn w:val="CaseCharacterBase"/><w:rPr><w:b/></w:rPr></w:style>
            <w:style w:type="character" w:styleId="CaseStrongChild"><w:name w:val="CaseStrongChild"/><w:basedOn w:val="CaseStrong"/></w:style>
          </w:styles>`,
            'application/xml'
          )
          for (const style of Array.from(inherited.getElementsByTagNameNS(W, 'style'))) {
            stylesDoc.documentElement.appendChild(stylesDoc.importNode(style, true))
          }
          zip.file('word/styles.xml', new XMLSerializer().serializeToString(stylesDoc))
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
          const beforePositioning = await readPositioningParagraph(beforeBytes)
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          const startedAtMs = Date.now()
          await sendWorkbenchMessage(
            page,
            `请直接修改我刚选中的 sample-edit.docx。精简“本产品”开头的产品定位段落，保留产品名称、三种工作模式名称、核心概念和原有格式。将完整的“风险段落：客户验收延期。”移到“日期”之后、“本周结论”之前；将本周结论中的126改为128；将“重点跟进”加粗；另将“其他内容”四个字加粗，保留该段已有字体颜色和黄色底色；其余文字与格式保留。在文末新增一段：“Workbench apply marker ${MARKER}”。完成后告诉我已写回。`
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
          const afterPositioning = await readPositioningParagraph(await fs.readFile(targetPath))
          runtime.signal({
            name: 'positioning-style-preservation-evidence',
            message: '记录精简前后真实文件的文字、加粗和缩进，以及实际读取和写入调用。',
            data: {
              beforePositioning,
              afterPositioning,
              docxCalls: evidence.events.filter(
                (event) =>
                  (event.type === 'tool_call_started' || event.type === 'tool_call_result') &&
                  event.toolName.startsWith('docx_')
              )
            }
          })
          const applyEntry = await waitForApplyEntryByFileName(page, 'sample-edit.docx')
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
          await assertDocxReviewOverview(runtime)
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
          await runtime.assertThat(
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
          await runtime.assertThat(
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
          await runtime.assertThat(
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
          const previewPositioning = await getWorkbenchLocator(page, workbenchSelectors.docxViewer)
            .locator('p')
            .filter({ hasText: CORE_NAMES[0]! })
            .first()
          await previewPositioning.waitFor({ state: 'visible', timeout: 30_000 })
          await assertEmptyDocxOverview(runtime)
          const previewPositioningText = await previewPositioning.textContent()
          const previewBoldText = await previewPositioning.evaluate((paragraph) => {
            const bold: string[] = []
            const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
            while (walker.nextNode()) {
              const node = walker.currentNode
              if (
                node.parentElement &&
                Number(getComputedStyle(node.parentElement).fontWeight) >= 600
              ) {
                bold.push(node.textContent || '')
              }
            }
            return bold.join('')
          })
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
            beforePositioning,
            afterPositioning,
            previewPositioningText,
            previewBoldText,
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
          const reviewIntro = result.reviewVisual.find((paragraph) =>
            paragraph.text.includes(CORE_NAMES[0]!)
          )
          const extraBold = CORE_NAMES.reduce(
            (text, name) => text.replaceAll(name, ''),
            result.afterPositioning.boldText
          ).replace(/[\s、，,。]/gu, '')
          await runtime.assertThat(
            result.afterPositioning.text.length < result.beforePositioning.text.length &&
              CORE_NAMES.every(
                (name) =>
                  result.afterPositioning.text.includes(name) &&
                  result.afterPositioning.boldText.includes(name)
              ) &&
              extraBold === '' &&
              Object.keys(result.afterPositioning.indent).length ===
                Object.keys(result.beforePositioning.indent).length &&
              Object.entries(result.beforePositioning.indent).every(
                ([name, value]) => result.afterPositioning.indent[name] === value
              ) &&
              result.afterPositioning.runs.every(
                (run) => run.style?.fontFamily === '宋体' && run.style.fontSize === 12
              ) &&
              result.previewPositioningText === result.afterPositioning.text &&
              result.previewBoldText === result.afterPositioning.boldText,
            {
              name: 'ai-simplification-preserves-inherited-formatting',
              message:
                '真实 AI 精简保留核心名称、局部继承加粗及原有缩进，普通文字不误加粗，文件与预览一致。',
              data: {
                before: result.beforePositioning,
                after: result.afterPositioning,
                previewText: result.previewPositioningText,
                previewBoldText: result.previewBoldText
              }
            }
          )
          await runtime.assertThat(
            !!reviewIntro &&
              reviewIntro.fragments.every(
                (fragment) =>
                  ['rgb(22, 101, 52)', 'rgb(180, 35, 24)'].includes(fragment.color) ||
                  (fragment.background !== 'rgb(233, 247, 239)' &&
                    fragment.border !== 'rgb(22, 101, 52)')
              ),
            {
              name: 'simplification-review-keeps-unchanged-format-unmarked',
              message: '精简段落中保留原格式的未变文字不产生纯格式绿色标记。',
              data: reviewIntro
            }
          )
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
