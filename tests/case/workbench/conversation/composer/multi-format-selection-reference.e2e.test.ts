import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { getSlidePartName, getSlides, loadPresentation } from 'pptx-kit'
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
        const screenRect = (index: number, range: Range) => {
          const parent = first.startContainer.parentElement
          if (!(parent instanceof SVGTextContentElement)) return range.getBoundingClientRect()
          const box = parent.getExtentOfChar(index)
          const matrix = parent.getScreenCTM()!
          const point = new DOMPoint(box.x, box.y).matrixTransform(matrix)
          return new DOMRect(point.x, point.y, box.width * matrix.a, box.height * matrix.d)
        }
        const a = screenRect(start, first),
          b = screenRect(end - 1, last)
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
          await selectVisibleText(page, '[data-ppt-interactive] svg')
          await confirm(page, 'ppt', '只解释这段幻灯片文字，不修改文件。')
          const textShape = page
            .locator('[data-ppt-interactive] [data-nc-shape-id]')
            .filter({ has: page.locator('text') })
            .first()
          const selectedElementId = `${expectedSlideId}#${await textShape.getAttribute('data-nc-shape-id')}`
          await textShape.click()
          await confirm(page, 'ppt', '只解释这个文本框，不修改文件。')
          await page.locator('[data-ppt-reference-page]').click()
          await confirm(
            page,
            'ppt',
            '请用 ppt_read_slides 按引用中的 slideId 读取当前页的元素清单，核对引用的文本框 elementId；只解释内容，不修改文件。'
          )
          await runtime.captureScreenshot({
            name: 'ppt-reference',
            message: 'PPT 文字、对象和整页通过真实标识引用'
          })
          const titles = await tokens.evaluateAll((elements) =>
            elements.map((element) => element.getAttribute('title'))
          )
          await runtime.assertThat(
            titles.length === 7 &&
              titles.some((title) => title?.includes('!')) &&
              titles.some((title) => title?.includes('整页')),
            {
              name: 'multi-format-drafts',
              message: '五种格式的七条引用保留定位信息。',
              data: { titles }
            }
          )
          await tokens.first().click()
          await text.waitFor({ state: 'visible' })
          const startedAt = Date.now()
          await submitWorkbenchCurrentDraft(page)
          await tokens.first().waitFor({ state: 'detached' })
          await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
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
              result.brain.includes(`页面标识：${result.expectedSlideId}`) &&
              result.brain.includes(`元素标识：${result.selectedElementId}`) &&
              result.brain.match(/选中片段 \d+：/g)?.length === 7 &&
              !result.brain.includes('选中时的画面：') &&
              result.brain.includes('经营周报.xlsx') &&
              result.brain.includes('深度学习.pdf'),
            {
              name: 'multi-format-brain-and-readonly',
              message: '真实 AI 收到独立选区块，PPT 引用标识与工具结果匹配，提问不写回源文件。',
              data: result
            }
          )
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
