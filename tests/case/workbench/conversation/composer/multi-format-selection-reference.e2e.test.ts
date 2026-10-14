import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import type { Locator, Page } from 'playwright'
import {
  addSlideImage,
  addBlankSlide,
  addSlideTextBox,
  addSlideShape,
  groupShapes,
  getGroupChildren,
  getShapeId,
  getShapeText,
  getSlideShapes,
  setShapeFill,
  setShapeTextFormat,
  emu,
  getSlidePartName,
  getSlides,
  getSlideSize,
  loadPresentation,
  savePresentation
} from 'pptx-kit'
import { describe, it } from 'vitest'
import { runE2ECase, type E2ETestRuntime } from '../../../../harness/e2e/run-e2e-case'
import { getExcelGridCanvas } from '../../../../harness/e2e/excel'
import { copyDocumentSelection } from '../../../../harness/e2e/documentSelection'
import {
  setupWorkbenchWithTempWorkspace,
  appendWorkbenchInputText,
  waitForWorkbenchMentionPanelText,
  openWorkbenchWorkspaceFile,
  getWorkbenchLocator,
  workbenchSelectors,
  submitWorkbenchCurrentDraft,
  waitForWorkbenchAiRunCompletion,
  collectWorkbenchLlmIoRecords,
  collectWorkbenchAiRunEvents,
  recordWorkbenchAiEvidence,
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'multi-format-selection-reference'
/** Read geometry only; selection itself always uses the real mouse. */
async function selectVisibleText(page: Page, selector: string, screenshotBefore = false) {
  const root = page.locator(selector).first()
  await root.waitFor({ state: 'visible' })
  await page.waitForFunction(
    (selector) => !!document.querySelector(selector)?.textContent?.trim(),
    selector
  )
  const points = await root.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node instanceof Text) {
      if (
        node.textContent &&
        node.textContent.trim().length >= 2 &&
        node.parentElement &&
        getComputedStyle(node.parentElement).visibility !== 'hidden'
      ) {
        const start = node.data.search(/\S/),
          end = Math.min(node.length, start + 5)
        const first = document.createRange(),
          last = document.createRange()
        first.setStart(node, start)
        first.setEnd(node, start + 1)
        last.setStart(node, end - 1)
        last.setEnd(node, end)
        const a = first.getBoundingClientRect(),
          b = last.getBoundingClientRect()
        if (a.width > 0 && a.height > 0 && a.top > 0 && b.bottom < window.innerHeight)
          return {
            x1: a.left + 0.5,
            y1: a.top + a.height / 2,
            x2: b.right - 0.5,
            y2: b.top + b.height / 2,
            text: node.data.slice(start, end),
            clip: { x: a.left, y: a.top, width: b.right - a.left, height: a.height }
          }
      }
      node = walker.nextNode()
    }
    throw new Error('没有可见可选文字')
  })
  const before = screenshotBefore ? await page.screenshot({ clip: points.clip }) : null
  await page.mouse.move(points.x1, points.y1)
  await page.mouse.down()
  await page.mouse.move(points.x2, points.y2, { steps: 12 })
  await page.mouse.up()
  return { ...points, before }
}

async function textPoint(locator: Locator, end = false) {
  return locator.evaluate((element, end) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const texts: Text[] = []
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (
        node instanceof Text &&
        node.data.trim() &&
        !node.parentElement?.closest('.vditor-ir__marker')
      )
        texts.push(node)
    const node = end ? texts.at(-1) : texts[0]
    if (!node) throw new Error('缺少可选正文')
    const range = document.createRange()
    const offset = end ? node.length - 1 : node.data.search(/\S/)
    range.setStart(node, offset)
    range.setEnd(node, offset + 1)
    const rect = range.getBoundingClientRect()
    return { x: end ? rect.right - 0.5 : rect.left + 0.5, y: rect.top + rect.height / 2 }
  }, end)
}

async function dragText(page: Page, start: Locator, end: Locator) {
  await start.scrollIntoViewIfNeeded()
  const a = await textPoint(start)
  const b = await textPoint(end, true)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 16 })
  await page.mouse.up()
}

async function assertSelectedTextVisible(
  runtime: E2ETestRuntime,
  format: 'pdf' | 'text',
  sample: Pick<Awaited<ReturnType<typeof selectVisibleText>>, 'before' | 'clip'>,
  state: string
) {
  if (!sample.before) throw new Error('缺少选区基准截图')
  const after = await runtime.page.screenshot({ clip: sample.clip })
  const counts = await runtime.electronApp.evaluate(
    ({ nativeImage }, screenshots) =>
      screenshots.map((encoded) => {
        const bitmap = nativeImage.createFromBuffer(Buffer.from(encoded, 'base64')).toBitmap()
        let dark = 0
        for (let i = 0; i < bitmap.length; i += 4)
          if (Math.max(bitmap[i], bitmap[i + 1], bitmap[i + 2]) < 170) dark++
        return dark
      }),
    [sample.before.toString('base64'), after.toString('base64')]
  )
  await runtime.assertThat(counts[0] > 20 && counts[1] >= counts[0] * 0.5, {
    name: `${format}-text-visible-${state}`,
    message: `${format} 高亮后选区中的深色文字仍可辨认，未被纯色背景盖住。`,
    data: { before: counts[0], after: counts[1], clip: sample.clip }
  })
  await runtime.captureScreenshot({
    name: `${format}-reference-${state}`,
    message: `${format} ${state} 高亮保持正文可见`
  })
}
async function assertSelectionPointer(
  runtime: E2ETestRuntime,
  format: string,
  point: { x: number; y: number }
) {
  const { page } = runtime
  const moveEvent = page.evaluate(
    () =>
      new Promise<{
        buttons: number
        target: string | null
        surface: string | null
        hovered: boolean
      } | null>((resolve) => {
        const finish = (event: PointerEvent) => {
          document.removeEventListener('pointermove', finish)
          clearTimeout(timeout)
          const target = event.target instanceof Element ? event.target : null
          resolve({
            buttons: event.buttons,
            target: target?.tagName || null,
            surface:
              target
                ?.closest('[data-document-selection-surface]')
                ?.getAttribute('data-document-selection-surface') || null,
            hovered: Boolean(target?.closest('[data-document-selection-hover]'))
          })
        }
        const timeout = setTimeout(() => {
          document.removeEventListener('pointermove', finish)
          resolve(null)
        }, 1000)
        document.addEventListener('pointermove', finish)
      })
  )
  await page.mouse.move(point.x, point.y)
  const move = await moveEvent
  await page
    .waitForFunction(
      (point) => {
        const element = document.elementFromPoint(point.x, point.y)
        return element && getComputedStyle(element).cursor === 'pointer'
      },
      point,
      { timeout: 5_000 }
    )
    .catch(() => {})
  const observed = await page.evaluate((point) => {
    const element = document.elementFromPoint(point.x, point.y)
    return {
      cursor: element ? getComputedStyle(element).cursor : null,
      element: element?.outerHTML.slice(0, 300),
      hovered: Boolean(element?.closest('[data-document-selection-hover]')),
      highlights: [...CSS.highlights].flatMap(([key, value]) =>
        [...value].flatMap((range) =>
          range instanceof Range
            ? [...range.getClientRects()].map((rect) => ({
                key,
                left: rect.left,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom
              }))
            : []
        )
      )
    }
  }, point)
  await runtime.assertThat(observed.cursor === 'pointer', {
    name: `${format}-saved-selection-pointer`,
    message: `${format} 已保存选区悬停时，实际命中的编辑控件使用点击光标。`,
    data: { point, move, ...observed }
  })
}

async function confirm(page: Page, prefix: string, thought: string) {
  await page.getByTestId(`${prefix}-selection-ai-reference`).click()
  await page.getByTestId(`${prefix}-selection-thought`).fill(thought)
  await page.getByTestId(`${prefix}-selection-save`).click()
  await page.getByTestId(`${prefix}-selection-popup`).waitFor({ state: 'detached' })
}

async function centerOf(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('拖动目标不可见')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '真实多格式选区引用、定位及混合发送。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const names = [
            'human-input.txt',
            'workbench-preview.md',
            '学习笔记/深度学习.pdf',
            '经营周报.xlsx',
            '品牌策略提案.pptx'
          ]
          const markdownPath = path.join(setup.workspace.rootPath, names[1])
          const repeatedParagraph = '重复前文'.repeat(20) + '重复定位标记' + '重复后文'.repeat(20)
          const markdownBody = [
            '## 0. 范围与总原则',
            '',
            '- 只做视觉与版式优化，**绝不遮挡文字**。',
            '- 主视觉：深藏蓝 `#0A2239 / #122C46` + 白。',
            '- 保留用户选中正文，中文结束。',
            '',
            '## 1. 表格定位',
            '',
            '| 检查项 | 结果 |',
            '| --- | --- |',
            '| 表格引用 | **准确定位** |',
            '',
            '## 2. 重复片段',
            '',
            repeatedParagraph,
            '',
            repeatedParagraph,
            ''
          ].join('\n')
          await fs.appendFile(markdownPath, '\n' + markdownBody)
          const pptPath = path.join(setup.workspace.rootPath, names[4])
          const deck = await loadPresentation(await fs.readFile(pptPath))
          const imageSource = await JSZip.loadAsync(
            await fs.readFile(path.join(setup.workspace.rootPath, 'docx-visual-kinds.docx'))
          )
          const size = getSlideSize(deck)
          addSlideImage(
            getSlides(deck)[0]!,
            await imageSource.file('word/media/image.png')!.async('uint8array'),
            {
              x: emu(Math.round(size.width * 0.72)),
              y: emu(Math.round(size.height * 0.58)),
              w: emu(Math.round(size.width * 0.15)),
              h: emu(Math.round(size.height * 0.2)),
              format: 'png'
            }
          )
          const groupSlide = addBlankSlide(deck)
          const groupTexts = ['组合引用测试甲', '组合引用测试乙']
          const groupTextShapes = groupTexts.map((text, index) => {
            const shape = addSlideTextBox(groupSlide, {
              x: emu(Math.round(size.width * 0.12)),
              y: emu(Math.round(size.height * (0.2 + index * 0.2))),
              w: emu(Math.round(size.width * 0.3)),
              h: emu(Math.round(size.height * 0.12)),
              text
            })
            setShapeTextFormat(shape, { size: 20 })
            return shape
          })
          const nested = groupShapes(groupTextShapes)
          const nestedShape = addSlideShape(groupSlide, {
            preset: 'rect',
            x: emu(Math.round(size.width * 0.48)),
            y: emu(Math.round(size.height * 0.2)),
            w: emu(Math.round(size.width * 0.12)),
            h: emu(Math.round(size.height * 0.2))
          })
          setShapeFill(nestedShape, '#FFD08A')
          const group = groupShapes([nested, nestedShape])
          const blankShape = addSlideShape(groupSlide, {
            preset: 'rect',
            x: emu(Math.round(size.width * 0.72)),
            y: emu(Math.round(size.height * 0.3)),
            w: emu(Math.round(size.width * 0.16)),
            h: emu(Math.round(size.height * 0.2))
          })
          setShapeFill(blankShape, '#17324D')
          const groupSlideId = getSlidePartName(groupSlide)
          const groupId = `${groupSlideId}#${getShapeId(group)}`
          const groupChildIds = getGroupChildren(group).map(
            (child) => `${groupSlideId}#${getShapeId(child)}`
          )
          const blankShapeId = `${groupSlideId}#${getShapeId(blankShape)}`
          const groupPage = getSlides(deck).length
          await fs.writeFile(pptPath, await savePresentation(deck))
          const before = await Promise.all(
            names.map((name) => fs.readFile(path.join(setup.workspace.rootPath, name)))
          )
          const openPreviewFile = async (name: string) => {
            await openWorkbenchWorkspaceFile(runtime, name)
            const overlay = getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerOverlay)
            if (await overlay.isVisible())
              await getWorkbenchLocator(page, workbenchSelectors.workspaceExplorerToggle).click()
            await overlay.waitFor({ state: 'hidden' })
          }
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          const tokens = composer.locator('[data-role="document-selection-token"]')
          await composer.click()
          await composer.press('Shift+Enter')
          await composer.press('Shift+Enter')
          await openPreviewFile(names[0])
          const text = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          const textClip = await text.evaluate((element) => {
            const rect = element.getBoundingClientRect()
            return { x: rect.left + 32, y: rect.top + 24, width: 195, height: 24 }
          })
          const textSample = { clip: textClip, before: await page.screenshot({ clip: textClip }) }
          await text.click()
          await text.press('ControlOrMeta+a')
          await page.getByTestId('text-selection-ai-reference').waitFor({ state: 'visible' })
          await assertSelectedTextVisible(runtime, 'text', textSample, 'action')
          const copiedText = await copyDocumentSelection(runtime)
          await runtime.assertThat(copiedText === before[0].toString('utf8'), {
            name: 'text-reference-native-copy',
            message: 'TXT 选中并显示 AI 引用入口后，原生复制保留完整选区。',
            data: { copiedText }
          })
          await confirm(page, 'text', '只解释这段文本，不修改文件。')
          await runtime.assertThat(
            await tokens.first().evaluate((token) => {
              const editor = token.closest('[contenteditable="true"]')
              return (
                editor && token.getBoundingClientRect().top - editor.getBoundingClientRect().top < 5
              )
            }),
            {
              name: 'first-reference-no-blank-line',
              message: '空草稿残留的换行不进入首个文档引用，引用从第一行开始。'
            }
          )
          await appendWorkbenchInputText(page, ' @sample-edit.docx')
          await waitForWorkbenchMentionPanelText(page)
          await getWorkbenchLocator(page, workbenchSelectors.mentionPanel)
            .getByRole('button', { name: /sample-edit\.docx/ })
            .click()
          await getWorkbenchLocator(page, workbenchSelectors.mentionPanel).waitFor({
            state: 'detached'
          })
          await runtime.assertThat(
            await composer.evaluate((element) => {
              const reference = element.querySelector('[data-role="scope-token"]')
              const selection = element.querySelector('[data-role="document-selection-token"]')
              if (!reference || !selection) return false
              const a = reference.getBoundingClientRect(),
                b = selection.getBoundingClientRect()
              return !element.textContent?.includes('\n') && Math.abs(a.bottom - b.bottom) < 6
            }),
            {
              name: 'reference-append-inline',
              message: '宽度足够时，@ 文件和追加的选区引用保持同行，没有主动插入换行。'
            }
          )
          await assertSelectedTextVisible(runtime, 'text', textSample, 'saved')
          const textHover = { x: textClip.x + 8, y: textClip.y + 12 }
          await assertSelectionPointer(runtime, 'text', textHover)
          await assertSelectedTextVisible(runtime, 'text', textSample, 'hover')
          await tokens.first().click()
          await page.waitForFunction((testId) => {
            const element = document.querySelector(`[data-testid="${testId}"]`)
            return (
              element instanceof HTMLTextAreaElement &&
              document.activeElement === element &&
              element.selectionStart === 0 &&
              element.selectionEnd === element.value.length
            )
          }, workbenchSelectors.plainTextEditor)
          await runtime.captureScreenshot({
            name: 'text-reference',
            message: '文本选区回跳与持久高亮'
          })
          await text.click({ position: { x: 40, y: 36 } })
          await page
            .getByTestId('text-selection-thought')
            .fill('解释原文并保留上下文，不修改文件。')
          await page.getByTestId('text-selection-save').click()
          await text.click({ position: { x: 40, y: 36 } })
          await page
            .getByTestId('text-selection-popup')
            .getByRole('button', { name: '删除引用' })
            .click()
          await tokens.first().waitFor({ state: 'detached' })
          await text.click()
          await text.press('ControlOrMeta+a')
          await confirm(page, 'text', '只解释这段文本，不修改文件。')
          await text.fill('原文已被替换，旧引用应保持快照且不再高亮。')
          await tokens.first().click()
          await page
            .getByText('原文已变化或位置不唯一，无法定位该选区。', { exact: true })
            .waitFor({ state: 'visible' })
          await runtime.assertThat(
            await page.evaluate(() =>
              [...CSS.highlights]
                .filter(([key]) => key.startsWith('text-'))
                .every(([, highlight]) => highlight.size === 0)
            ),
            {
              name: 'stale-text-reference',
              message: '原文改变后不把旧引用高亮到新内容。'
            }
          )
          await text.fill(before[0].toString('utf8'))
          await tokens.first().click()
          const composerWidth = await composer.evaluate(
            (element) => element.getBoundingClientRect().width
          )
          await composer.click({ position: { x: composerWidth - 4, y: 4 } })
          await composer.press('ControlOrMeta+End')
          await composer.press('Shift+Enter')
          const textBeforeMarkdown = await composer.textContent()
          await openPreviewFile(names[1])
          const markdown = page.locator('.vditor-ir .vditor-reset')
          const tableStart = markdown.locator('table').last().locator('th').first()
          const tableEnd = markdown.locator('table').last().locator('td').last()
          await dragText(page, tableStart, tableEnd)
          await confirm(page, 'text', '解释表格引用。')
          await runtime.assertThat(
            Boolean(textBeforeMarkdown?.includes('\n')) &&
              Boolean((await composer.textContent())?.startsWith(textBeforeMarkdown || '')),
            {
              name: 'reference-manual-newline-preserved',
              message: '用户输入的换行在追加引用后原样保留。',
              data: { textBeforeMarkdown, after: await composer.textContent() }
            }
          )
          const tableTitle = (await tokens.last().getAttribute('title')) || ''
          await runtime.assertThat(
            tableTitle.includes('检查项\t结果') && tableTitle.includes('表格引用\t准确定位'),
            {
              name: 'markdown-gfm-table-reference',
              message: '真实 GFM 表格选区能对应原文，保留行列内容。',
              data: { title: tableTitle }
            }
          )
          await tableStart.click()
          await page
            .getByTestId('text-selection-popup')
            .getByRole('button', { name: '删除引用' })
            .click()
          const repeated = markdown.locator('p').filter({ hasText: '重复定位标记' }).nth(1)
          await repeated.scrollIntoViewIfNeeded()
          const repeatedPoint = await textPoint(repeated)
          await page.mouse.move(repeatedPoint.x, repeatedPoint.y)
          await page.mouse.down()
          await page.mouse.move(repeatedPoint.x + 58, repeatedPoint.y, { steps: 8 })
          await page.mouse.up()
          await confirm(page, 'text', '解释第二处重复文字。')
          const repeatedTitle = (await tokens.last().getAttribute('title')) || ''
          const markdownSource = await fs.readFile(markdownPath, 'utf8')
          const repeatedLine = markdownSource
            .slice(0, markdownSource.lastIndexOf(repeatedParagraph))
            .split('\n').length
          await runtime.assertThat(repeatedTitle.includes(`位置：第 ${repeatedLine} 行`), {
            name: 'markdown-repeated-source-position',
            message: '上下文相同的重复文字按真实选中位置定位到第二段。',
            data: { title: repeatedTitle, line: repeatedLine }
          })
          await page.mouse.click(repeatedPoint.x, repeatedPoint.y)
          await page
            .getByTestId('text-selection-popup')
            .getByRole('button', { name: '删除引用' })
            .click()
          const markdownStart = markdown.getByRole('heading', { name: '0. 范围与总原则' })
          const markdownEnd = markdown.locator('li').filter({ hasText: '中文结束' })
          await dragText(page, markdownStart, markdownEnd)
          await page.getByTestId('text-selection-ai-reference').waitFor({ state: 'visible' })
          const copiedMarkdown = await copyDocumentSelection(runtime)
          await runtime.assertThat(
            ['0. 范围与总原则', '绝不遮挡文字', '#0A2239 / #122C46', '中文结束'].every((text) =>
              copiedMarkdown.includes(text)
            ) && !copiedMarkdown.includes('1. 表格定位'),
            {
              name: 'markdown-reference-native-copy',
              message: '跨标题、列表、粗体与行内代码选区可正常复制，未带入外围段落。',
              data: { copied: copiedMarkdown }
            }
          )
          await runtime.captureScreenshot({
            name: 'markdown-selection-action',
            message: 'Markdown 跨样式正文选区与引用入口'
          })
          await page.getByTestId('text-selection-ai-reference').click()
          const thought = page.getByTestId('text-selection-thought')
          await thought.fill('只解释这段 Markdown，不修改文件。')
          await thought.press('ControlOrMeta+a')
          const copiedThought = await copyDocumentSelection(runtime)
          await runtime.assertThat(copiedThought === '只解释这段 Markdown，不修改文件。', {
            name: 'reference-thought-native-copy',
            message: '进入想法输入框后，复制遵循输入框选区。',
            data: { copied: copiedThought }
          })
          await page.getByTestId('text-selection-save').click()
          const markdownTitle = (await tokens.last().getAttribute('title')) || ''
          await runtime.assertThat(
            markdownTitle.includes('绝不遮挡文字') &&
              markdownTitle.includes('#0A2239 / #122C46') &&
              !markdownTitle.includes('**'),
            {
              name: 'markdown-visible-content-reference',
              message: '引用仅包含可见正文，隐藏 Markdown 标记不混入内容。',
              data: { title: markdownTitle }
            }
          )
          await tokens.last().click()
          const returnPoint = await textPoint(markdownStart)
          await assertSelectionPointer(runtime, 'markdown', returnPoint)
          await page.mouse.click(returnPoint.x, returnPoint.y)
          await thought.waitFor({ state: 'visible' })
          await page.getByTestId('text-selection-save').click()
          await openPreviewFile(names[2])
          const pdfSample = await selectVisibleText(page, '[data-pdf-page="1"] .textLayer', true)
          await page.getByTestId('pdf-selection-ai-reference').waitFor({ state: 'visible' })
          const copiedPdf = await copyDocumentSelection(runtime)
          await runtime.assertThat(copiedPdf === pdfSample.text, {
            name: 'pdf-reference-native-copy',
            message: 'PDF 原生文字选区在 AI 引用入口出现后仍可复制。',
            data: { expected: pdfSample.text, copied: copiedPdf }
          })
          await assertSelectedTextVisible(runtime, 'pdf', pdfSample, 'action')
          await confirm(page, 'pdf', '只解释 PDF 引文，不修改文件。')
          await page.mouse.move(pdfSample.x2 + 150, pdfSample.y2)
          await assertSelectedTextVisible(runtime, 'pdf', pdfSample, 'saved')
          await page.mouse.move(pdfSample.x1, pdfSample.y1)
          await assertSelectedTextVisible(runtime, 'pdf', pdfSample, 'hover')
          await openPreviewFile(names[3])
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-excel-ready') === 'true',
            workbenchSelectors.excelViewer
          )
          await getExcelGridCanvas(page).click({ position: { x: 110, y: 90 } })
          await page.keyboard.press('Shift+ArrowRight')
          await confirm(page, 'excel', '只解释这些单元格的值或公式，不修改文件。')
          const excelCanvasBox = await getExcelGridCanvas(page).boundingBox()
          if (!excelCanvasBox) throw new Error('Excel 主画布不可见')
          await assertSelectionPointer(runtime, 'excel', {
            x: excelCanvasBox.x + 110,
            y: excelCanvasBox.y + 90
          })
          await page.mouse.click(excelCanvasBox.x + 110, excelCanvasBox.y + 90)
          await page.getByTestId('excel-selection-thought').waitFor({ state: 'visible' })
          await page.getByTestId('excel-selection-save').click()
          const excelTitle = (await tokens.last().getAttribute('title')) || ''
          const excelLocation = excelTitle.match(/\n位置：([^\n]+)!([A-Z]+\d+(?::[A-Z]+\d+)?)\n/)
          if (!excelLocation) throw new Error('Excel 引用没有工作表和范围')
          const excelSnapshot = excelTitle.slice(excelLocation.index! + excelLocation[0].length)
          const excelDisplay = (JSON.parse(excelSnapshot) as { display: string[][] }).display
          const expectedExcel = {
            sheetName: excelLocation[1],
            range: excelLocation[2],
            values: excelDisplay.flat().filter(Boolean)
          }
          await runtime.captureScreenshot({
            name: 'excel-reference',
            message: 'Excel 区域引用与原生紫色高亮'
          })
          await openPreviewFile(names[4])
          await page.locator('[data-ppt-interactive] svg').waitFor({ state: 'visible' })
          await page.waitForFunction(() =>
            [...CSS.highlights.keys()].some((key) => key.startsWith('ppt-'))
          )
          const presentation = await loadPresentation(before[4])
          const expectedSlideId = getSlidePartName(getSlides(presentation)[0]!)
          const expectedElementIds = await page
            .locator('[data-ppt-interactive] [data-nc-shape-id]')
            .evaluateAll(
              (elements, slideId) =>
                elements.map((element) => `${slideId}#${element.getAttribute('data-nc-shape-id')}`),
              expectedSlideId
            )
          const textShape = page
            .locator('[data-ppt-interactive] [data-nc-shape-id]')
            .filter({ has: page.locator('text') })
            .first()
          const selectedElementId = `${expectedSlideId}#${await textShape.getAttribute('data-nc-shape-id')}`
          const expectedText = (await textShape.locator('text').allTextContents()).join('\n')
          const expectedSourceText = getShapeText(
            getSlideShapes(getSlides(presentation)[0]!).find(
              (shape) => `${expectedSlideId}#${getShapeId(shape)}` === selectedElementId
            )!
          )
          const imageShape = page
            .locator('[data-ppt-interactive] [data-nc-shape-id]')
            .filter({ has: page.locator('image') })
            .first()
          const surface = page.getByTestId('ppt-preview-after')
          const selectedImageId = `${expectedSlideId}#${await imageShape.getAttribute('data-nc-shape-id')}`
          const transform = surface.locator(':scope > div[style*="transform"]')
          const readViewport = () =>
            transform.evaluate((element) => {
              const matrix = new DOMMatrix(getComputedStyle(element).transform)
              return { scale: matrix.a, x: matrix.e, y: matrix.f }
            })
          const popup = page.getByTestId('ppt-selection-popup')
          const cursorAt = (point: { x: number; y: number }) =>
            page.evaluate(({ x, y }) => {
              const element = document.elementFromPoint(x, y)
              return element ? getComputedStyle(element).cursor : ''
            }, point)
          const blankPoint = () =>
            surface.evaluate((element) => {
              const box = element.getBoundingClientRect()
              return { x: box.left + 5, y: box.top + 5 }
            })
          const drag = async (
            name: string,
            origin: { x: number; y: number },
            options: {
              delta?: { x: number; y: number }
              returnToStart?: boolean
              button?: 'left' | 'middle'
              space?: boolean
              cancel?: boolean
            } = {}
          ) => {
            const beforeStyle = await transform.getAttribute('style')
            const beforeViewport = await readViewport()
            const delta = options.delta || { x: 40, y: 24 }
            const tokenCount = await tokens.count()
            await page.mouse.move(origin.x, origin.y)
            if (options.space) await page.keyboard.down('Space')
            await page.mouse.down({ button: options.button || 'left' })
            const downCursor = await cursorAt(origin)
            await page.mouse.move(origin.x + delta.x, origin.y + delta.y, { steps: 12 })
            await page.waitForFunction(
              () =>
                getComputedStyle(document.querySelector('[data-testid="ppt-preview-after"]')!)
                  .cursor === 'grabbing'
            )
            const movingCursor = await cursorAt({ x: origin.x + delta.x, y: origin.y + delta.y })
            const movingStyle = await transform.getAttribute('style')
            const movingViewport = await readViewport()
            if (options.returnToStart) await page.mouse.move(origin.x, origin.y, { steps: 12 })
            if (options.cancel) await page.keyboard.press('Escape')
            await page.mouse.up({ button: options.button || 'left' })
            if (options.space) await page.keyboard.up('Space')
            await page.waitForFunction(
              () =>
                getComputedStyle(document.querySelector('[data-testid="ppt-preview-after"]')!)
                  .cursor !== 'grabbing'
            )
            const observed = {
              beforeStyle,
              movingStyle,
              downCursor,
              movingCursor,
              afterCursor: await cursorAt(origin),
              popupCount: await popup.count(),
              warnings: await page.locator('.ant-message-warning').allTextContents(),
              tokenCount: await tokens.count(),
              nativeText: await page.evaluate(() => window.getSelection()?.toString() || '')
            }
            const afterViewport = await readViewport()
            await runtime.assertThat(
              movingStyle !== beforeStyle &&
                movingCursor === 'grabbing' &&
                Math.abs(movingViewport.x - beforeViewport.x - delta.x) < 1 &&
                Math.abs(movingViewport.y - beforeViewport.y - delta.y) < 1 &&
                Math.abs(
                  afterViewport.x - beforeViewport.x - (options.returnToStart ? 0 : delta.x)
                ) < 1 &&
                Math.abs(
                  afterViewport.y - beforeViewport.y - (options.returnToStart ? 0 : delta.y)
                ) < 1 &&
                downCursor !== 'grabbing' &&
                observed.afterCursor !== 'grabbing' &&
                observed.popupCount === 0 &&
                observed.warnings.length === 0 &&
                observed.tokenCount === tokenCount &&
                observed.nativeText === '',
              {
                name,
                message:
                  '画布完整跟随鼠标位移，不触发引用、编辑浮层、文字选择或 toast，光标与实际拖动一致。',
                data: { ...observed, beforeViewport, movingViewport, afterViewport, delta }
              }
            )
          }
          const titleText = textShape.locator('text').first()
          await drag('ppt-drag-at-fit', await centerOf(titleText))
          const viewer = page.getByTestId('ppt-preview-viewer')
          await viewer.getByRole('button', { name: '缩小', exact: true }).click()
          const shrunkViewport = await readViewport()
          await runtime.assertThat(
            shrunkViewport.scale === 0.8 && shrunkViewport.x === 40 && shrunkViewport.y === 24,
            {
              name: 'ppt-zoom-keeps-pan',
              message: '缩小到 100% 以下仍保留手动平移位置。',
              data: shrunkViewport
            }
          )
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          for (let index = 0; index < 7; index++)
            await viewer.getByRole('button', { name: '缩小', exact: true }).click()
          const minimumViewport = await readViewport()
          const surfaceBox = await surface.boundingBox()
          if (!surfaceBox) throw new Error('PPT 画布不可见')
          const largeDelta = {
            x: Math.floor(surfaceBox.width * 0.7),
            y: Math.floor(surfaceBox.height * 0.6)
          }
          await runtime.assertThat(minimumViewport.scale === 0.25, {
            name: 'ppt-minimum-zoom',
            message: '通过真实缩放按钮到达 25% 最小缩放。',
            data: minimumViewport
          })
          await drag('ppt-pan-at-minimum-zoom', await blankPoint(), { delta: largeDelta })
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          const reset = await readViewport()
          await runtime.assertThat(reset.scale === 1 && reset.x === 0 && reset.y === 0, {
            name: 'ppt-fit-restores-center',
            message: '适应窗口将自由平移的画布恢复为 100% 并居中。',
            data: reset
          })
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          await titleText.hover()
          await runtime.assertThat((await cursorAt(await centerOf(titleText))) === 'pointer', {
            name: 'ppt-element-cursor',
            message: '放大后悬停文字元素显示点击手形。'
          })
          await drag('ppt-text-pan', await centerOf(titleText))
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          await drag('ppt-image-pan', await centerOf(imageShape))
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          const blank = await blankPoint()
          await page.mouse.move(blank.x, blank.y)
          await runtime.assertThat((await cursorAt(blank)) === 'grab', {
            name: 'ppt-blank-cursor',
            message: '放大后空白画布显示可平移抓手。'
          })
          await drag('ppt-blank-pan', blank, { delta: largeDelta })
          const wheelPoint = await blankPoint()
          const wheelObservations: Array<{
            before: { scale: number; x: number; y: number }
            after: { scale: number; x: number; y: number }
          }> = []
          for (let index = 0; index < 2; index++) {
            const before = await readViewport()
            await page.mouse.move(wheelPoint.x, wheelPoint.y)
            await page.mouse.wheel(0, 100)
            await page.waitForFunction((scale) => {
              const element = document.querySelector(
                '[data-testid="ppt-preview-after"] > div[style*="transform"]'
              )!
              return new DOMMatrix(getComputedStyle(element).transform).a < scale
            }, before.scale)
            wheelObservations.push({ before, after: await readViewport() })
          }
          const pointerX = wheelPoint.x - surfaceBox.x - surfaceBox.width / 2
          const pointerY = wheelPoint.y - surfaceBox.y - surfaceBox.height / 2
          await runtime.assertThat(
            wheelObservations.at(-1)!.after.scale < 1 &&
              wheelObservations.every(({ before, after }) => {
                const ratio = after.scale / before.scale
                return (
                  Math.abs(after.x - (before.x + (pointerX - before.x) * (1 - ratio))) < 1 &&
                  Math.abs(after.y - (before.y + (pointerY - before.y) * (1 - ratio))) < 1
                )
              }),
            {
              name: 'ppt-wheel-keeps-anchor-below-fit',
              message: '自由平移后滚轮缩放跨越 100% 仍保持鼠标锚点，不回中或限制位移。',
              data: { wheelObservations, pointerX, pointerY }
            }
          )
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await drag('ppt-middle-pan', await blankPoint(), { button: 'middle' })
          await drag('ppt-space-pan', await centerOf(titleText), { space: true })
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await textShape.click()
          await confirm(page, 'ppt', '只解释这个文本框，不修改文件。')
          const textTitle = await tokens.last().getAttribute('title')
          await runtime.assertThat(
            !!textTitle?.includes(`选中元素：${selectedElementId}`) &&
              textTitle.endsWith('\n' + expectedText) &&
              !textTitle.includes('选中文字'),
            {
              name: 'ppt-whole-text-box',
              message: '点击文字引用完整文本框。',
              data: { textTitle, expectedText }
            }
          )
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          await drag('ppt-saved-element-pan', await centerOf(titleText))
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          await drag('ppt-pan-back-to-origin', await centerOf(titleText), { returnToStart: true })
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await viewer.getByRole('button', { name: '放大', exact: true }).click()
          await drag('ppt-cancel-pan', await centerOf(titleText), { cancel: true })
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await textShape.click()
          await page
            .getByTestId('ppt-selection-thought')
            .fill('只解释完整文本框，保留其他元素，不修改文件。')
          await page.getByTestId('ppt-selection-save').click()
          await popup.waitFor({ state: 'detached' })
          await imageShape.click()
          await confirm(page, 'ppt', '只解释这张图片，不修改文件。')
          const imageTitle = await tokens.last().getAttribute('title')
          await runtime.assertThat(!!imageTitle?.includes(`选中元素：${selectedImageId}`), {
            name: 'ppt-image-element',
            message: '点击图片引用该图片元素的真实标识。',
            data: { imageTitle, selectedImageId }
          })
          await page.locator('[data-ppt-reference-page]').focus()
          await page.keyboard.press('Enter')
          await confirm(
            page,
            'ppt',
            '请用 ppt_read_slides 按引用中的 slideId 读取当前页的元素清单，核对引用的文本框 elementId；只解释内容，不修改文件。'
          )
          await runtime.captureScreenshot({
            name: 'ppt-reference',
            message: 'PPT 文本框、图片和整页通过真实标识引用'
          })
          // A saved whole-page reference must not intercept clicks on an unquoted element.
          await page
            .locator('[data-ppt-interactive] [data-nc-shape-id]')
            .filter({ has: page.locator('text') })
            .nth(1)
            .click()
          await page.getByTestId('ppt-selection-ai-reference').waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await popup.waitFor({ state: 'detached' })
          await page
            .getByTestId('ppt-preview-thumbnails')
            .getByRole('button', { name: `第 ${groupPage} 页`, exact: true })
            .click()
          const groupElement = page.locator(
            `[data-ppt-interactive] [data-nc-shape-id="${getShapeId(group)}"]`
          )
          await groupElement.waitFor({ state: 'visible' })
          const groupMarkup = await page.locator('[data-ppt-interactive] svg').evaluate((svg) => ({
            selectable: [...svg.querySelectorAll('[data-nc-shape-id]')].map((element) =>
              element.getAttribute('data-nc-shape-id')
            ),
            text: [...svg.querySelectorAll('text')].map((element) => element.textContent)
          }))
          await runtime.assertThat(
            groupMarkup.selectable.length === 2 &&
              groupMarkup.selectable.includes(String(getShapeId(group))) &&
              groupTexts.every(
                (text) => groupMarkup.text.filter((value) => value === text).length === 1
              ),
            {
              name: 'ppt-group-rendered-once',
              message: '嵌套组合后代只渲染一次，交互层仅保留外层组合和独立对象。',
              data: groupMarkup
            }
          )
          await drag('ppt-group-pan', await centerOf(groupElement.locator('text').first()))
          await viewer.getByRole('button', { name: '适应窗口' }).click()
          await groupElement.locator('text').first().click()
          await confirm(
            page,
            'ppt',
            '请通过 PPT 工具读取这个组合及其子元素，解释组合中的两段文字，不修改文件。'
          )
          const groupTitle = await tokens.last().getAttribute('title')
          await groupElement.locator('text').last().click()
          await page.getByTestId('ppt-selection-thought').waitFor({ state: 'visible' })
          await page.keyboard.press('Escape')
          await popup.waitFor({ state: 'detached' })
          await page
            .locator(`[data-ppt-interactive] [data-nc-shape-id="${getShapeId(blankShape)}"]`)
            .click()
          await confirm(page, 'ppt', '只检查这个无文字形状的类型，不修改文件。')
          const blankTitle = await tokens.last().getAttribute('title')
          await runtime.assertThat(
            groupTitle?.includes(`选中元素：${groupId}`) &&
              blankTitle?.endsWith(`\n位置：第 ${groupPage} 页\n选中元素：${blankShapeId}`),
            {
              name: 'ppt-group-and-blank-selection',
              message: '点击不同组合子元素仍定位同一外层组合，无文字形状也能按身份引用。',
              data: { groupTitle, blankTitle, groupId, blankShapeId }
            }
          )
          const titles = await tokens.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('title'))
          )
          await runtime.assertThat(
            titles.length === 9 &&
              titles.some((title) => title?.includes('!')) &&
              titles.some((title) => title?.includes('选中页面')),
            {
              name: 'multi-format-drafts',
              message: '五种格式的九条引用保留定位信息。',
              data: { titles }
            }
          )
          await tokens.first().click()
          await text.waitFor({ state: 'visible' })
          const startedAt = Date.now()
          await submitWorkbenchCurrentDraft(page)
          await tokens.first().waitFor({ state: 'detached' })
          const sentReference = getWorkbenchLocator(page, workbenchSelectors.userMessageReferences)
            .last()
            .locator('[data-role="reference-inline-token"]')
          await sentReference.waitFor({ state: 'visible' })
          await runtime.assertThat(
            await sentReference.evaluate((token) => {
              const style = getComputedStyle(token)
              const icon = token.querySelector('[data-reference-icon-kind] svg')
              return (
                style.color === 'rgb(55, 53, 47)' &&
                style.backgroundColor === 'rgba(0, 0, 0, 0)' &&
                icon?.getBoundingClientRect().width === 18
              )
            }),
            {
              name: 'reference-sent-message-style',
              message: '已发送用户消息中的 @ 引用与输入区一致：正文色、无灰底、18px 图标。'
            }
          )
          const evidence = await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          recordWorkbenchAiEvidence(runtime, evidence, 1)
          const events = await collectWorkbenchAiRunEvents(runtime)
          const pptReads = events.flatMap((event) => {
            if (
              event.type !== 'tool_call_result' ||
              event.toolName !== 'ppt_read_slides' ||
              !event.result?.ok
            )
              return []
            const data = event.result.data
            if (
              !data ||
              typeof data !== 'object' ||
              Array.isArray(data) ||
              !Array.isArray(data.slides)
            )
              return []
            return data.slides.flatMap((slide) => {
              if (!slide || typeof slide !== 'object' || Array.isArray(slide)) return []
              return [
                {
                  slideId: slide.slideId,
                  groups: Array.isArray(slide.elements)
                    ? slide.elements
                        .filter(
                          (element) =>
                            element &&
                            typeof element === 'object' &&
                            !Array.isArray(element) &&
                            element.type === 'group'
                        )
                        .map(
                          (element) =>
                            element as {
                              elementId: string
                              details?: { childElementIds?: string[] }
                            }
                        )
                    : [],
                  elementIds: Array.isArray(slide.elements)
                    ? slide.elements.flatMap((element) =>
                        element &&
                        typeof element === 'object' &&
                        !Array.isArray(element) &&
                        typeof element.elementId === 'string'
                          ? [element.elementId]
                          : []
                      )
                    : []
                }
              ]
            })
          })
          const records = await collectWorkbenchLlmIoRecords(runtime)
          const toolReadContent = (toolName: string) => {
            const readCallIds = new Set(
              events
                .filter((event) => event.type === 'tool_call_result' && event.toolName === toolName)
                .map((event) => event.toolCallId)
            )
            return records
              .filter((record) => record.caller === 'human.brain' && record.startedAt >= startedAt)
              .flatMap(
                (record) =>
                  record.requestWire?.messages
                    .filter(
                      (message) =>
                        message.role === 'tool' && readCallIds.has(message.toolCallId || '')
                    )
                    .map((message) => message.content) || []
              )
              .join('\n')
          }
          const modelReadContent = toolReadContent('ppt_read_slides')
          const excelReadContent = toolReadContent('excel_read')
          const excelRangeReads = events.flatMap((event) => {
            if (
              event.type !== 'tool_call_result' ||
              event.toolName !== 'excel_read' ||
              !event.result?.ok
            )
              return []
            const data = event.result.data
            return data &&
              typeof data === 'object' &&
              !Array.isArray(data) &&
              Array.isArray(data.rows)
              ? [data]
              : []
          })
          const brain =
            records
              .find((record) => record.caller === 'human.brain' && record.startedAt >= startedAt)
              ?.requestWire?.messages.filter((message) => message.role === 'human')
              .map((message) => message.content)
              .join('\n') || ''
          const after = await Promise.all(
            names.map((name) => fs.readFile(path.join(setup.workspace.rootPath, name)))
          )
          await assertNoWorkbenchFakeSignals(runtime)
          return {
            titles,
            brain,
            expectedExcel,
            excelSnapshot,
            excelReadContent,
            excelRangeReads,
            expectedSlideId,
            expectedElementIds,
            selectedElementId,
            selectedImageId,
            groupId,
            groupChildIds,
            groupSlideId,
            groupTexts,
            blankShapeId,
            expectedText,
            expectedSourceText,
            modelReadContent,
            pptReads,
            unchanged: after.every((bytes, index) => bytes.equals(before[index]))
          }
        },
        assert: async (result, runtime) => {
          runtime.assertThat(
            result.unchanged &&
              result.expectedElementIds.length > 0 &&
              result.pptReads.some(
                (slide) =>
                  slide.slideId === result.expectedSlideId &&
                  result.expectedElementIds.every((id) => slide.elementIds.includes(id)) &&
                  slide.elementIds.includes(result.selectedElementId)
              ) &&
              result.pptReads.some(
                (slide) =>
                  slide.slideId === result.groupSlideId &&
                  slide.elementIds.includes(result.blankShapeId) &&
                  slide.groups.some(
                    (group) =>
                      group.elementId === result.groupId &&
                      JSON.stringify(group.details?.childElementIds) ===
                        JSON.stringify(result.groupChildIds)
                  )
              ) &&
              result.brain.includes(`选中页面：${result.expectedSlideId}`) &&
              [
                result.selectedElementId,
                result.selectedImageId,
                result.groupId,
                result.blankShapeId
              ].every((id) => result.brain.includes(`选中元素：${id}`)) &&
              result.brain.match(/<用户选中片段\d+>/g)?.length === 9 &&
              result.brain.includes('</用户选中片段1>\n<用户选中片段2>') &&
              !/<\/用户选中片段\d+>\n\n<用户选中片段/.test(result.brain) &&
              result.brain.includes('知识库文档ID：无\n<用户选中片段1>') &&
              !result.brain.includes('知识库文档ID：无\n\n<用户选中片段') &&
              result.brain.includes(
                `<定位信息>\n工作表：${result.expectedExcel.sheetName}\n选中单元格范围：${result.expectedExcel.range}\n</定位信息>`
              ) &&
              !result.brain.includes(result.excelSnapshot) &&
              !result.brain.includes('merges') &&
              !result.brain.includes('不属于选中内容') &&
              !result.brain.includes('以下片段仅用于定位。') &&
              !result.brain.includes('</选中内容>\n\n<定位信息>') &&
              result.expectedExcel.values.length > 0 &&
              result.expectedExcel.values.every((value) =>
                result.excelReadContent.includes(value)
              ) &&
              result.excelRangeReads.some(
                (read) => read.sheetName === result.expectedExcel.sheetName
              ) &&
              (result.brain.match(/<用户选中片段\d+>[\s\S]*?<\/用户选中片段\d+>/g) || [])
                .filter(
                  (block) =>
                    block.includes('选中元素：') ||
                    block.includes('选中页面：') ||
                    block.includes('工作表：')
                )
                .every(
                  (block) =>
                    !block.includes('<选中内容>') &&
                    block.includes('<定位信息>') &&
                    !block.includes('<选中内容的前文>') &&
                    !block.includes('<选中内容的后文>')
                ) &&
              !result.brain.includes('页面标识：') &&
              result.groupTexts.every(
                (text) => !result.brain.includes(text) && result.modelReadContent.includes(text)
              ) &&
              result.expectedSourceText
                .split(/\r?\n/)
                .filter(Boolean)
                .every((text) => result.modelReadContent.includes(text)) &&
              result.modelReadContent.includes(result.groupId) &&
              result.groupChildIds.every((id) => result.modelReadContent.includes(id)) &&
              !result.brain.includes('选中时的画面：') &&
              result.brain.includes('经营周报.xlsx') &&
              result.brain.includes('深度学习.pdf'),
            {
              name: 'multi-format-brain-and-readonly',
              message:
                '真实 AI 的 Excel/PPT 片段仅包含定位，工具内容进入下一轮模型且组合关系匹配，提问不写回源文件。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
