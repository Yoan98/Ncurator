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
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  setupWorkbenchWithTempWorkspace,
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
async function selectVisibleText(page: Page, selector: string): Promise<void> {
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
            y2: b.top + b.height / 2
          }
      }
      node = walker.nextNode()
    }
    throw new Error('没有可见可选文字')
  })
  await page.mouse.move(points.x1, points.y1)
  await page.mouse.down()
  await page.mouse.move(points.x2, points.y2, { steps: 12 })
  await page.mouse.up()
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
        windowMode: 'background',
        execution: 'live',
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
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          const tokens = composer.locator('[data-role="document-selection-token"]')
          await openWorkbenchWorkspaceFile(runtime, names[0])
          const text = getWorkbenchLocator(page, workbenchSelectors.plainTextEditor)
          await text.click()
          await text.press('ControlOrMeta+a')
          await confirm(page, 'text', '只解释这段文本，不修改文件。')
          await tokens.first().click()
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
          await openWorkbenchWorkspaceFile(runtime, names[1])
          await selectVisibleText(page, '.vditor-ir')
          await confirm(page, 'text', '只解释这段 Markdown，不修改文件。')
          await openWorkbenchWorkspaceFile(runtime, names[2])
          await selectVisibleText(page, '[data-pdf-page="1"] .textLayer')
          await confirm(page, 'pdf', '只解释 PDF 引文，不修改文件。')
          await openWorkbenchWorkspaceFile(runtime, names[3])
          const excel = getWorkbenchLocator(page, workbenchSelectors.excelViewer)
          await page.waitForFunction(
            (testId) =>
              document
                .querySelector(`[data-testid="${testId}"]`)
                ?.getAttribute('data-excel-ready') === 'true',
            workbenchSelectors.excelViewer
          )
          await excel
            .locator('canvas')
            .first()
            .click({ position: { x: 110, y: 90 } })
          await page.keyboard.press('Shift+ArrowRight')
          await confirm(page, 'excel', '只解释这些单元格的值或公式，不修改文件。')
          await runtime.captureScreenshot({
            name: 'excel-reference',
            message: 'Excel 区域引用与原生紫色高亮'
          })
          await openWorkbenchWorkspaceFile(runtime, names[4])
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
          const readCallIds = new Set(
            events
              .filter(
                (event) => event.type === 'tool_call_result' && event.toolName === 'ppt_read_slides'
              )
              .map((event) => event.toolCallId)
          )
          const modelReadContent = records
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
              (result.brain.match(/<用户选中片段\d+>[\s\S]*?<\/用户选中片段\d+>/g) || [])
                .filter((block) => block.includes('选中元素：') || block.includes('选中页面：'))
                .every(
                  (block) =>
                    !block.includes('<选中内容>') &&
                    !block.includes('<前文>') &&
                    !block.includes('<后文>')
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
                '真实 AI 的 PPT 片段仅包含定位，工具内容进入下一轮模型且组合关系匹配，提问不写回源文件。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
