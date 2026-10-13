import {
  assertDocxReferenceOverview,
  assertEmptyDocxOverview
} from '../../../../harness/e2e/docxOverview'
import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { Page } from 'playwright'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { copyDocumentSelection } from '../../../../harness/e2e/documentSelection'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  collectWorkbenchLlmIoRecords,
  createPartnerThroughWorkbenchUi,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  getWorkbenchLocator,
  openWorkbenchWorkspaceFile,
  readDocxPlainText,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-selection-reference'
const textPoint = (
  page: Page,
  paragraph: number,
  offset: number,
  selector = 'article p',
  center = false
) =>
  page
    .locator('.docx-content')
    .first()
    .evaluate(
      (viewer, input) => {
        const paragraph = viewer.querySelectorAll(input.selector)[input.paragraph]
        const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
        let offset = input.offset
        let node = walker.nextNode()
        while (node instanceof Text) {
          if (offset <= node.length) {
            const range = document.createRange()
            range.setStart(node, Math.max(0, offset === node.length ? offset - 1 : offset))
            range.setEnd(node, Math.min(node.length, offset === node.length ? offset : offset + 1))
            const rect = range.getBoundingClientRect()
            return {
              x: input.center
                ? rect.left + rect.width / 2
                : offset === node.length
                  ? rect.right - 0.5
                  : rect.left + 0.5,
              y: rect.top + rect.height / 2
            }
          }
          offset -= node.length
          node = walker.nextNode()
        }
        throw new Error('文本位置不存在')
      },
      { paragraph, offset, selector, center }
    )

const clickSavedText = async (
  page: Page,
  paragraph: number,
  offset: number,
  selector = 'article p'
) => {
  await page.locator('.docx-content').locator(selector).nth(paragraph).scrollIntoViewIfNeeded()
  const point = await textPoint(page, paragraph, offset, selector, true)
  await page.mouse.click(point.x, point.y)
  await page.getByTestId('docx-selection-thought').waitFor({ state: 'visible' })
}

const observeSavedSelections = (page: Page) =>
  page.evaluate(() => ({
    quotes: [...CSS.highlights]
      .filter(([key]) => key.startsWith('docx-') && !/-(active|hover)$/.test(key))
      .flatMap(([, highlight]) => [...highlight])
      .filter((range): range is Range => range instanceof Range)
      .map((range) => range.toString()),
    numberCount: document.querySelectorAll('[data-testid="docx-selection-marker"]').length
  }))

const observeHover = (page: Page, point: { x: number; y: number }) =>
  page.evaluate(({ x, y }) => {
    const element = document.elementFromPoint(x, y)
    const hover = [...CSS.highlights].find(
      ([key, highlight]) => key.endsWith('-hover') && highlight.size
    )
    return {
      cursor: element ? getComputedStyle(element).cursor : '',
      quote: hover
        ? [...hover[1]].map((range) => (range instanceof Range ? range.toString() : '')).join('')
        : '',
      background: hover
        ? getComputedStyle(
            document.querySelector('.docx-content')!,
            '::highlight(' + hover[0] + ')'
          ).backgroundColor
        : ''
    }
  }, point)

const selectText = async (
  page: Page,
  startParagraph: number,
  start: number,
  endParagraph: number,
  end: number,
  options: { selector?: string; popup?: boolean; editor?: boolean } = {}
) => {
  await page.bringToFront()
  await page.waitForFunction(() =>
    [...CSS.highlights.keys()].some((key) => key.startsWith('docx-'))
  )
  await page.locator('.docx-content').click({ position: { x: 5, y: 5 } })
  await page
    .locator('.docx-content')
    .locator(options.selector || 'article p')
    .nth(startParagraph)
    .scrollIntoViewIfNeeded()
  const startPoint = await textPoint(page, startParagraph, start, options.selector)
  // Hold Shift before releasing the first click so saved text remains a selection anchor.
  await page.mouse.move(startPoint.x, startPoint.y)
  await page.mouse.down()
  await page.keyboard.down('Shift')
  try {
    await page.mouse.up()
    await page
      .locator('.docx-content')
      .locator(options.selector || 'article p')
      .nth(endParagraph)
      .scrollIntoViewIfNeeded()
    const endPoint = await textPoint(page, endParagraph, end, options.selector)
    await page.mouse.click(endPoint.x, endPoint.y)
  } finally {
    await page.keyboard.up('Shift')
  }
  if (options.popup !== false) {
    await page.getByTestId('docx-selection-ai-reference').waitFor({ state: 'visible' })
    if (options.editor !== false) {
      await page.getByTestId('docx-selection-ai-reference').click()
      await page.getByTestId('docx-selection-thought').waitFor({ state: 'visible' })
    }
  }
}

const observeSelectionUi = (page: Page) =>
  page.evaluate(() => {
    const viewer = document.querySelector('.docx-content')!
    const viewport = viewer.getBoundingClientRect()
    const popup = document.querySelector<HTMLElement>('[data-testid="docx-selection-popup"]')
    const floating = popup?.getBoundingClientRect()
    const active = [...CSS.highlights].find(
      ([key, highlight]) => key.endsWith('-active') && highlight.size > 0
    )
    const range = active && [...active[1]].find((item) => item instanceof Range)
    const editor = document.querySelector('[data-testid="docx-selection-thought"]')
    return {
      quote: range instanceof Range ? range.toString() : '',
      background: active
        ? getComputedStyle(viewer, '::highlight(' + active[0] + ')').backgroundColor
        : '',
      decoration: active
        ? getComputedStyle(viewer, '::highlight(' + active[0] + ')').textDecorationLine
        : '',
      focused: document.activeElement === editor,
      editorVisible: Boolean(editor),
      popupExists: Boolean(popup),
      scrollTop: viewer.scrollTop,
      placement: popup?.dataset.placement,
      height: floating?.height || 0,
      withinViewport: Boolean(
        floating &&
        floating.left >= viewport.left &&
        floating.right <= viewport.right &&
        floating.top >= viewport.top &&
        floating.bottom <= viewport.bottom
      ),
      placeholder: editor?.getAttribute('data-placeholder'),
      confirmIcon: Boolean(document.querySelector('[data-testid="docx-selection-save"] svg')),
      confirmLabel: document
        .querySelector('[data-testid="docx-selection-save"]')
        ?.getAttribute('aria-label'),
      fontSize: editor ? getComputedStyle(editor).fontSize : '',
      lineHeight: editor ? getComputedStyle(editor).lineHeight : ''
    }
  })

describe('workbench conversation e2e', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'conversation',
        groups: ['composer'],
        description: '通过真实鼠标选区和键盘操作验证混合正文同步、定位及提交清理。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          const sourcePaths = ['工作/客户周会纪要.docx', 'docx-selection-layout.docx'].map((name) =>
            path.join(setup.workspace.rootPath, name)
          )
          const originalSources = await Promise.all(
            sourcePaths.map((source) => fs.readFile(source))
          )
          const readDraftSelections = () =>
            composer.locator('[data-role="document-selection-fragment"]').evaluateAll((fragments) =>
              fragments.map((fragment) => ({
                label: fragment
                  .querySelector('[data-role="document-selection-token"]')
                  ?.getAttribute('aria-label'),
                quote: fragment
                  .querySelector('[data-role="document-selection-token"]')
                  ?.getAttribute('title')
                  ?.split('\n')
                  .slice(1)
                  .join('\n'),
                thought: fragment.querySelector('[data-role="document-selection-thought"]')
                  ?.textContent
              }))
            )
          await openWorkbenchWorkspaceFile(runtime, 'sample-edit.docx')
          await page.locator('.docx-content article p').first().waitFor({ state: 'visible' })
          await assertEmptyDocxOverview(runtime)
          for (const selection of [
            { start: 0, end: 5, thought: '第一段' },
            { start: 6, end: 10, thought: '第二段' },
            { start: 11, end: 18, thought: '第三段' }
          ]) {
            await selectText(page, 0, selection.start, 0, selection.end)
            if (selection.start === 0) await assertEmptyDocxOverview(runtime)
            await page.getByTestId('docx-selection-thought').fill(selection.thought)
            await page.getByRole('button', { name: '添加到输入框', exact: true }).click()
          }
          await page.locator('.docx-content article p').first().hover()
          await assertDocxReferenceOverview(runtime)
          const savedUi = await observeSavedSelections(page)
          const hoveredSelections: Awaited<ReturnType<typeof observeHover>>[] = []
          for (const selection of [
            { offset: 1, quote: 'Hello' },
            { offset: 7, quote: 'from' },
            { offset: 12, quote: 'fixture' }
          ]) {
            const point = await textPoint(page, 0, selection.offset, 'article p', true)
            await page.mouse.move(point.x, point.y, { steps: 2 })
            await page.waitForFunction(
              (quote) =>
                [...CSS.highlights].some(
                  ([key, highlight]) =>
                    key.endsWith('-hover') &&
                    [...highlight].some(
                      (range) => range instanceof Range && range.toString() === quote
                    )
                ),
              selection.quote
            )
            hoveredSelections.push(await observeHover(page, point))
          }
          const spacePoint = await textPoint(page, 0, 5, 'article p', true)
          await page.mouse.move(spacePoint.x, spacePoint.y)
          await page.waitForFunction(
            () =>
              ![...CSS.highlights].some(
                ([key, highlight]) => key.endsWith('-hover') && highlight.size
              )
          )
          const spaceHover = await observeHover(page, spacePoint)
          await runtime.assertThat(
            savedUi.numberCount === 0 &&
              savedUi.quotes.join(',') === 'Hello,from,fixture' &&
              hoveredSelections.map((hover) => hover.quote).join(',') === 'Hello,from,fixture' &&
              hoveredSelections.every(
                (hover) => hover.cursor === 'pointer' && hover.background === 'rgb(219, 197, 246)'
              ) &&
              spaceHover.cursor !== 'pointer' &&
              !spaceHover.quote,
            {
              name: 'selection-highlight-hover-without-numbers',
              message: '右侧只展示高亮；悬停各选区有手形和加深背景，未选中的空格无点击反馈。',
              data: { savedUi, hoveredSelections, spaceHover }
            }
          )
          await clickSavedText(page, 0, 7)
          const editConfirmLabel = (await observeSelectionUi(page)).confirmLabel
          const editedQuote = (await observeSelectionUi(page)).quote
          const editedThought = await page.getByTestId('docx-selection-thought').textContent()
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          const afterMiddleDelete = await readDraftSelections()
          const afterMiddleHighlights = await observeSavedSelections(page)
          await runtime.assertThat(
            afterMiddleDelete[0]?.label === 'sample-edit.docx · 1' &&
              afterMiddleDelete[0].quote === 'Hello' &&
              afterMiddleDelete[0].thought === '第一段' &&
              afterMiddleDelete[1]?.label === 'sample-edit.docx · 2' &&
              afterMiddleDelete[1].quote === 'fixture' &&
              afterMiddleDelete[1].thought === '第三段' &&
              afterMiddleHighlights.quotes.join(',') === 'Hello,fixture' &&
              editedQuote === 'from' &&
              editedThought === '第二段' &&
              editConfirmLabel === '确认修改',
            {
              name: 'selection-popup-delete-renumbers-composer',
              message:
                '点击高亮打开对应内容；删除中间引用后左侧连续编号，右侧移除对应高亮，原文和想法保持关联。',
              data: {
                afterMiddleDelete,
                afterMiddleHighlights,
                editConfirmLabel,
                editedQuote,
                editedThought
              }
            }
          )
          await composer
            .locator('[data-role="document-selection-thought"]')
            .first()
            .click({ position: { x: 0.5, y: 8 } })
          await page.keyboard.press('Backspace')
          const afterComposerDelete = await readDraftSelections()
          const afterComposerHighlights = await observeSavedSelections(page)
          await runtime.assertThat(
            afterComposerDelete.length === 1 &&
              afterComposerDelete[0]?.label === 'sample-edit.docx · 1' &&
              afterComposerDelete[0].quote === 'fixture' &&
              afterComposerDelete[0].thought === '第三段' &&
              afterComposerHighlights.quotes.join(',') === 'fixture',
            {
              name: 'selection-composer-delete-renumbers-and-clears-highlight',
              message: '输入区直接删除引用后剩余编号同步重排，内容保持关联。',
              data: { afterComposerDelete, afterComposerHighlights }
            }
          )
          // The existing "fixture" reference was confirmed first. The overview must
          // still cycle Hello/from/fixture in document order, independent of numbering.
          for (const selection of [
            { start: 0, end: 5 },
            { start: 6, end: 10 }
          ]) {
            await selectText(page, 0, selection.start, 0, selection.end)
            await page.getByTestId('docx-selection-thought').fill('位置顺序验证')
            await page.getByTestId('docx-selection-save').click()
          }
          await page.locator('.docx-content article p').first().hover()
          await assertDocxReferenceOverview(runtime)
          await composer.fill('')
          await selectText(page, 0, 0, 0, 5)
          await page.getByTestId('docx-selection-thought').fill('重新添加')
          await page.getByTestId('docx-selection-save').click()
          const afterClear = await readDraftSelections()
          const afterClearHighlights = await observeSavedSelections(page)
          await runtime.assertThat(
            afterClear[0]?.label === 'sample-edit.docx · 1' &&
              afterClearHighlights.quotes.join(',') === 'Hello',
            {
              name: 'selection-clear-restarts-at-one',
              message: '删除全部引用后再次添加从 1 开始。',
              data: { afterClear, afterClearHighlights }
            }
          )
          await clickSavedText(page, 0, 1)
          await runtime.captureScreenshot({
            name: 'selection-compact-confirm',
            message: '点击紫色高亮打开对勾确认输入条，右侧无编号'
          })
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          await composer.fill('')
          await openWorkbenchWorkspaceFile(runtime, '工作/客户周会纪要.docx')
          await page
            .locator('.docx-content article p')
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 })
          await selectText(page, 0, 0, 1, 8, { editor: false })
          const actionUi = await observeSelectionUi(page)
          const copiedDocx = await copyDocumentSelection(runtime)
          await runtime.assertThat(
            !!actionUi.quote && copiedDocx.replace(/\s/g, '') === actionUi.quote.replace(/\s/g, ''),
            {
              name: 'docx-reference-native-copy',
              message: 'DOCX 跨段落选区显示 AI 引用入口后，系统剪贴板仍收到当前原文。',
              data: { expected: actionUi.quote, copied: copiedDocx }
            }
          )
          await runtime.captureScreenshot({
            name: 'selection-action',
            message: '紫色选区与 AI 引用入口'
          })
          await page.getByTestId('docx-selection-ai-reference').click()
          await page.getByTestId('docx-selection-thought').waitFor({ state: 'visible' })
          const inputUi = await observeSelectionUi(page)
          await page.getByTestId('docx-selection-thought').fill('第一行')
          await page.getByTestId('docx-selection-thought').press('Shift+Enter')
          await page.keyboard.type('第二行')
          const multilineText = await page.getByTestId('docx-selection-thought').innerText()
          const multilineUi = await observeSelectionUi(page)
          await runtime.assertThat(
            multilineText === '第一行\n第二行' && multilineUi.height > inputUi.height,
            {
              name: 'selection-editor-line-break',
              message: 'Shift+Enter 后继续输入应位于新行，输入条随内容增高。',
              data: { multilineText, multilineUi }
            }
          )
          await page.getByTestId('docx-selection-thought').press('Escape')
          const escapeCancelled = (await page.getByTestId('docx-selection-popup').count()) === 0
          await selectText(page, 0, 0, 1, 8)
          await page.getByTestId('docx-selection-thought').fill('不保存的输入')
          await page.locator('.docx-content').click({ position: { x: 5, y: 5 } })
          const outsideCancelled = (await page.getByTestId('docx-selection-popup').count()) === 0
          await selectText(page, 0, 0, 1, 8)
          await runtime.captureScreenshot({
            name: 'selection-popup',
            message: 'DOCX 紫色原文高亮与紧凑确认输入条'
          })
          const emptyDisabled = await page.getByTestId('docx-selection-save').isDisabled()
          await page
            .getByTestId('docx-selection-thought')
            .fill('请解释这段的关键约束，无需修改文件。')
          await page.getByTestId('docx-selection-thought').press('Enter')
          await composer.locator('[data-role="document-selection-token"]').waitFor()
          const excerpt = (
            await composer.locator('[data-role="document-selection-token"]').getAttribute('title')
          )
            ?.split('\n')
            .slice(1)
            .join('\n')
          const label = await composer
            .locator('[data-role="document-selection-token"]')
            .getAttribute('aria-label')
          const tokenIcon =
            (await composer.locator('[data-role="document-selection-token"] svg').count()) === 1
          const highlightedQuote = await observeSavedSelections(page)
          const blankPoint = await page
            .locator('.docx-content article p')
            .nth(1)
            .evaluate((paragraph) => {
              const rect = paragraph.getBoundingClientRect()
              return { x: rect.right - 5, y: rect.top + rect.height / 2 }
            })
          await page.mouse.move(blankPoint.x, blankPoint.y)
          const blankHover = await observeHover(page, blankPoint)
          await selectText(page, 1, 8, 1, 16)
          await page.getByTestId('docx-selection-thought').fill('临时相邻引用')
          await page.getByTestId('docx-selection-save').click()
          const adjacentHighlights = await observeSavedSelections(page)
          await clickSavedText(page, 1, 12)
          const adjacentThought = await page.getByTestId('docx-selection-thought').textContent()
          await page.getByRole('button', { name: '删除引用', exact: true }).click()

          const windowHandle = await runtime.electronApp.browserWindow(page)
          const originalSize = await windowHandle.evaluate((window) => window.getSize())
          await windowHandle.evaluate((window) => window.setSize(1100, 720))
          await selectText(page, 9, 0, 9, 2)
          await page.getByTestId('docx-selection-thought').fill('缩放保留此输入')
          const scroll = await page.evaluate(() => {
            const viewer = document.querySelector('.docx-content')!
            const viewport = viewer.getBoundingClientRect()
            const active = [...CSS.highlights].find(
              ([key, highlight]) => key.endsWith('-active') && highlight.size
            )
            const range = active && [...active[1]].find((item) => item instanceof Range)
            const end = range instanceof Range ? [...range.getClientRects()].at(-1) : null
            if (!end) throw new Error('选区未高亮')
            return {
              x: viewport.left + 5,
              y: viewport.top + 20,
              delta: end.bottom - (viewport.bottom - 12)
            }
          })
          await page.mouse.move(scroll.x, scroll.y)
          await page.mouse.wheel(0, scroll.delta)
          await page.waitForFunction(
            () =>
              document.querySelector<HTMLElement>('[data-testid="docx-selection-popup"]')?.dataset
                .placement === 'above'
          )
          const flippedUi = await observeSelectionUi(page)
          await runtime.captureScreenshot({
            name: 'selection-flipped',
            message: '预览底部选区的输入条向上避让'
          })
          await windowHandle.evaluate(
            (window, size) => window.setSize(size[0], size[1]),
            originalSize
          )
          await windowHandle.dispose()
          await page.locator('.docx-content article p').nth(9).scrollIntoViewIfNeeded()
          await runtime.captureScreenshot({
            name: 'selection-resized',
            message: '窗口恢复后的选区和输入条'
          })
          await runtime.assertThat((await observeSelectionUi(page)).editorVisible, {
            name: 'selection-editor-survives-resize',
            message: '窗口缩放后编辑输入条仍存在。',
            data: await observeSelectionUi(page)
          })
          await page.getByTestId('docx-selection-thought').waitFor({ state: 'visible' })
          const resizedUi = await observeSelectionUi(page)
          const resizedText = await page.getByTestId('docx-selection-thought').textContent()
          await page.getByTestId('docx-selection-thought').press('Escape')
          await composer.locator('[data-role="document-selection-token"]').click()
          await composer.locator('[data-role="document-selection-thought"]').click()
          await page.keyboard.press('End')
          await page.keyboard.type(' 重点说明谨慎表述。')
          const locatedUi = await observeSavedSelections(page)
          await runtime.assertThat(locatedUi.quotes.length === 1 && locatedUi.numberCount === 0, {
            name: 'selection-highlight-after-locating',
            message: '跨段落引用定位后保留原文高亮，右侧不展示编号。',
            data: locatedUi
          })
          await clickSavedText(page, 1, 4)
          const synchronized =
            (await page.getByTestId('docx-selection-thought').textContent())?.includes(
              '重点说明谨慎表述。'
            ) || false
          await page
            .getByTestId('docx-selection-thought')
            .fill('解释所选原文，并说明风险控制建议。无需改写文件。')
          await page.getByTestId('docx-selection-save').click()
          await composer.locator('[data-role="document-selection-token"]').click()
          const located = await page.evaluate(() => window.getSelection()?.toString() || '')
          await selectText(page, 0, 0, 1, 8, { popup: false })
          const repeatedUi = await page.evaluate(() => ({
            selected: window.getSelection()?.toString() || '',
            popup: Boolean(document.querySelector('[data-testid="docx-selection-popup"]')),
            overlapNotice: document.body.textContent?.includes('该选区与已有编号重叠') || false
          }))
          await clickSavedText(page, 0, 2)
          const repeatedThought = await page.getByTestId('docx-selection-thought').textContent()
          await page.getByTestId('docx-selection-thought').press('Escape')
          const count = await composer.locator('[data-role="document-selection-token"]').count()
          await selectText(page, 0, 0, 1, 12, { popup: false })
          const overlapUi = await page.evaluate(() => ({
            selected: window.getSelection()?.toString() || '',
            popup: Boolean(document.querySelector('[data-testid="docx-selection-popup"]')),
            overlapNotice: document.body.textContent?.includes('该选区与已有编号重叠') || false
          }))
          const overlappingReferenceCount = await composer
            .locator('[data-role="document-selection-token"]')
            .count()
          await runtime.captureScreenshot({
            name: 'selection-overlap',
            message: '重叠选择保留原生选中范围，不弹提示或 AI 引用入口'
          })
          await createPartnerThroughWorkbenchUi(page, '选区隔离伙伴')
          const otherPartnerEmpty =
            (await getWorkbenchLocator(page, workbenchSelectors.input)
              .locator('[data-role="document-selection-token"]')
              .count()) === 0
          await getWorkbenchLocator(page, workbenchSelectors.partnersList)
            .getByText(setup.workspaceName, { exact: true })
            .click()
          await composer.locator('[data-role="document-selection-token"]').waitFor()
          const memoryRestored = (await composer.textContent())?.includes('风险控制建议') || false
          await openWorkbenchWorkspaceFile(runtime, '人工智能探究课堂PRD.docx')
          await page
            .locator('.docx-content article td p')
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 })
          await selectText(page, 0, 0, 0, 2, { selector: 'article td p' })
          const cellQuote = (await observeSelectionUi(page)).quote
          await page.getByTestId('docx-selection-thought').fill('解释这个表格字段。')
          await page.getByTestId('docx-selection-save').click()
          await composer
            .locator('[data-role="document-selection-thought"]')
            .last()
            .click({ position: { x: 0.5, y: 8 } })
          await page.keyboard.press('Backspace')
          const atomicDeleted =
            (await composer.locator('[data-role="document-selection-token"]').count()) === 1
          await selectText(page, 0, 0, 1, 4, { selector: 'article td p' })
          await page.getByTestId('docx-selection-thought').fill('解释这两个表头。')
          await page.getByTestId('docx-selection-save').click()
          const crossCellQuote = (await readDraftSelections()).at(-1)?.quote
          await clickSavedText(page, 1, 1, 'article td p')
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          await selectText(page, 0, 0, 0, 2, { selector: 'article td p' })
          await page.getByTestId('docx-selection-thought').fill('临时引用。')
          await page.getByTestId('docx-selection-save').click()
          const resetLabel = await composer
            .locator('[data-role="document-selection-token"]')
            .last()
            .getAttribute('aria-label')
          await clickSavedText(page, 0, 0, 'article td p')
          await page.getByRole('button', { name: '删除引用', exact: true }).click()

          await openWorkbenchWorkspaceFile(runtime, 'docx-selection-layout.docx')
          await page.locator('.docx-content article table').waitFor({ state: 'visible' })
          const cellSelector = 'article table td p'
          const cellTexts = await page
            .locator('.docx-content')
            .locator(cellSelector)
            .allTextContents()
          const lastCell = cellTexts.length - 1
          const tableText =
            'Area\tOwner\tNotes\tStatus\n\nDesign\tAda\tFirst line\nSecond line\nThird paragraph\tReady\n\nBuild\tShared work\t\tPending\n\n\tBea\t\tDone'
          const confirmExcerpt = async (thought: string) => {
            await page.getByTestId('docx-selection-thought').fill(thought)
            await page.getByTestId('docx-selection-save').click()
            return (await readDraftSelections()).at(-1)?.quote
          }
          const removeExcerpt = async (
            paragraph: number,
            offset: number,
            selector = 'article p'
          ) => {
            await clickSavedText(page, paragraph, offset, selector)
            await page.getByRole('button', { name: '删除引用', exact: true }).click()
          }
          await selectText(page, 0, 0, lastCell, cellTexts[lastCell].length, {
            selector: cellSelector
          })
          const wholeTableQuote = await confirmExcerpt('解释所选整张表格。')
          await composer.locator('[data-role="document-selection-token"]').last().click()
          const locatedTable = await page.evaluate(() => window.getSelection()?.toString() || '')
          await clickSavedText(page, 2, 1, cellSelector)
          const tableThought = await page.getByTestId('docx-selection-thought').textContent()
          await runtime.captureScreenshot({
            name: 'selection-whole-table',
            message: '整表引用保留多段落单元格、空格及合并占位，点击高亮重新编辑'
          })
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          await selectText(page, lastCell, cellTexts[lastCell].length, 0, 0, {
            selector: cellSelector
          })
          const reversedTableQuote = await confirmExcerpt('反向选择整表。')
          await removeExcerpt(0, 1, cellSelector)

          const paragraphIndex = (text: string) =>
            page
              .locator('.docx-content article p')
              .evaluateAll(
                (paragraphs, text) =>
                  paragraphs.findIndex((paragraph) => paragraph.textContent === text),
                text
              )
          const beforeTable = await paragraphIndex('Text before table.')
          const afterTable = await paragraphIndex('Text after table.')
          await selectText(page, beforeTable, 0, afterTable, 'Text after table.'.length)
          const mixedTableQuote = await confirmExcerpt('解释表格及前后正文。')
          await removeExcerpt(beforeTable, 2)
          await selectText(page, 0, 0, 0, 'Selection header'.length, { selector: 'header p' })
          const headerQuote = await confirmExcerpt('解释页眉。')
          await removeExcerpt(0, 1, 'header p')
          await selectText(page, 0, 0, 0, 'Selection footer'.length, { selector: 'footer p' })
          const footerQuote = await confirmExcerpt('解释页脚。')
          await removeExcerpt(0, 1, 'footer p')
          const firstPage = await paragraphIndex('Page one end.')
          const secondPage = await paragraphIndex('Page two start.')
          await selectText(page, firstPage, 0, secondPage, 'Page two start.'.length)
          const crossPageQuote = await confirmExcerpt('解释跨页选区。')
          const pageCount = await page.locator('.docx-content section.docx').count()
          await removeExcerpt(secondPage, 1)

          const imageBefore = await paragraphIndex('Image before.')
          const imageAfter = await paragraphIndex('Image after.')
          await selectText(page, imageBefore, 0, imageAfter, 'Image after.'.length)
          const imageMixedQuote = await confirmExcerpt('解释图片前后的文字。')
          await removeExcerpt(imageBefore, 1)
          await selectText(page, imageBefore, 'Image before.'.length, imageAfter, 0, {
            popup: false
          })
          const toast = page
            .locator('.ant-message-notice')
            .filter({ hasText: '当前选区没有可读取的文字。' })
          await toast.waitFor({ state: 'visible' })
          const toastCount = await toast.count()
          const noInlineNotice =
            !(await page.locator('.docx-content').textContent())?.includes(
              '当前选区没有可读取的文字。'
            ) && (await page.getByTestId('docx-selection-popup').count()) === 0
          await runtime.captureScreenshot({
            name: 'selection-system-toast',
            message: '纯图片选区使用统一系统 toast，同一提示合并，文档内无提示条'
          })
          await toast.waitFor({ state: 'detached', timeout: 10_000 })
          await runtime.assertThat(
            wholeTableQuote === tableText &&
              reversedTableQuote === tableText &&
              tableThought === '解释所选整张表格。' &&
              locatedTable.includes('First line') &&
              locatedTable.includes('Done') &&
              mixedTableQuote === 'Text before table.\n' + tableText + '\nText after table.' &&
              headerQuote === 'Selection header' &&
              footerQuote === 'Selection footer' &&
              pageCount === 2 &&
              crossPageQuote?.startsWith('Page one end.') === true &&
              crossPageQuote.endsWith('Page two start.') &&
              imageMixedQuote?.includes('Image before.') === true &&
              imageMixedQuote.includes('Image after.') &&
              toastCount === 1 &&
              noInlineNotice,
            {
              name: 'docx-selection-table-pages-and-toast',
              message:
                '真实整表、反向选择、正文混选、合并与空单元格、单元格内换行、页眉页脚、跨页及图片混选正确；无文字使用单个自动消失的系统 toast。',
              data: {
                wholeTableQuote,
                reversedTableQuote,
                mixedTableQuote,
                headerQuote,
                footerQuote,
                crossPageQuote,
                pageCount,
                imageMixedQuote,
                tableThought,
                locatedTable,
                toastCount,
                noInlineNotice
              }
            }
          )
          await composer.locator('[data-role="document-selection-token"]').click()
          await page
            .locator('.docx-content article p')
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 })
          await runtime.captureScreenshot({
            name: 'selection-composer',
            message: '混合正文中的编号引用与右侧高亮'
          })
          const startedAt = Date.now()
          await submitWorkbenchCurrentDraft(page)
          await composer
            .locator('[data-role="document-selection-token"]')
            .waitFor({ state: 'detached' })
          const submittedHighlights = await observeSavedSelections(page)
          await assertEmptyDocxOverview(runtime)
          await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          const brainInput =
            (await collectWorkbenchLlmIoRecords(runtime))
              .find((record) => record.caller === 'human.brain' && record.startedAt >= startedAt)
              ?.requestWire?.messages.filter((message) => message.role === 'human')
              .map((message) => message.content)
              .join('\n\n') || ''
          const finalSources = await Promise.all(sourcePaths.map((source) => fs.readFile(source)))
          await runtime.assertThat(
            brainInput.includes('<用户选中片段1>') &&
              brainInput.includes('<选中内容>\n') &&
              !brainInput.includes('<选中内容的前文>') &&
              brainInput.includes('</选中内容>\n<定位信息>\n') &&
              brainInput.includes('<选中内容的后文>\n') &&
              brainInput.includes('</选中内容的后文>\n</定位信息>') &&
              !brainInput.includes('不属于选中内容') &&
              !brainInput.includes('以下选中片段') &&
              finalSources.every((bytes, index) => bytes.equals(originalSources[index])),
            {
              name: 'document-reference-brain-blocks-and-question-preservation',
              message: '真实模型输入将原文与片段上下文分块；引用提问不修改源文档。',
              data: { brainInput }
            }
          )
          const historyText = await getWorkbenchLocator(
            page,
            workbenchSelectors.userMessageReferences
          )
            .last()
            .textContent()
          const historyLabel = await getWorkbenchLocator(
            page,
            workbenchSelectors.userMessageReferences
          )
            .last()
            .locator('[data-role="document-selection-token"]')
            .getAttribute('aria-label')
          await selectText(page, 0, 0, 0, 2)
          await page.getByTestId('docx-selection-thought').fill('新一轮引用')
          await page.getByTestId('docx-selection-save').click()
          const nextDraftLabel = await composer
            .locator('[data-role="document-selection-token"]')
            .getAttribute('aria-label')
          const frozenHistoryLabel = await getWorkbenchLocator(
            page,
            workbenchSelectors.userMessageReferences
          )
            .last()
            .locator('[data-role="document-selection-token"]')
            .getAttribute('aria-label')
          await clickSavedText(page, 0, 0)
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          await page
            .locator(`[data-testid^="${workbenchSelectors.userMessageEditButtonPrefix}-"]`)
            .last()
            .click()
          await getWorkbenchLocator(page, workbenchSelectors.editMessageConfirmButton).click()
          await composer.locator('[data-role="document-selection-token"]').waitFor()
          const historyRestored = (await composer.textContent())?.includes('风险控制建议') || false
          await insertWorkbenchReferenceToken(page, 'sample-edit.docx')
          await composer.click()
          await page.keyboard.press(
            process.platform === 'darwin' ? 'Meta+ArrowRight' : 'Control+End'
          )
          await page.keyboard.type(' 保留普通草稿。')
          const readPersistedDraft = () =>
            page.evaluate(async () => {
              const { state: active } = await window.api.workbenchUiStateGet()
              return active.activeViewKey
                ? (await window.api.partnerOpen({ partnerId: active.activeViewKey, limit: 1 }))
                    .uiState
                : null
            })
          let acceptedPartnerState = await readPersistedDraft()
          const persistenceDeadline = Date.now() + 10_000
          while (
            !acceptedPartnerState?.composer.draft.input.includes('保留普通草稿。') ||
            !acceptedPartnerState.composer.draft.contentNodes.some(
              (node) => node.kind === 'reference'
            )
          ) {
            if (Date.now() >= persistenceDeadline) throw new Error('普通正文与 @ 引用未持久化')
            await new Promise<void>((resolve) => setTimeout(resolve, 100))
            acceptedPartnerState = await readPersistedDraft()
          }
          const storedSelections =
            acceptedPartnerState?.composer.draft.contentNodes.filter(
              (node) => node.kind === 'document_selection'
            ).length || 0
          await page.reload()
          await navigateToWorkbench(page)
          await composer.locator('[data-role="scope-token"]').waitFor()
          const restartedText = await composer.textContent()
          const restartedSelections = await composer
            .locator('[data-role="document-selection-token"]')
            .count()

          const selectedParagraph =
            '产品定位：我们希望通过人工智能技术为教师和学生提供一个能够支持课堂探究、协作学习和即时反馈的综合性学习平台，让教师能够更加高效地组织课堂，让学生能够更加主动地参与学习并深入理解知识。'
          const scopePath = await writeTestDocxFile(
            setup.workspace.rootPath,
            'selection-scope.docx',
            [
              { type: 'paragraph', text: '一、课堂产品定位' },
              { type: 'paragraph', text: selectedParagraph },
              {
                type: 'paragraph',
                text: '自主探究：学生能够自主提出问题、反复尝试解决方案并记录探索过程，通过持续的问题发现和思考来提升学习能力。'
              },
              {
                type: 'paragraph',
                text: '小组共创：学生在小组协作中共同讨论问题、分享自己的观点并参与成果设计，教师及时观察并指导每一个小组的合作过程。'
              }
            ]
          )
          const scopeBefore = await readDocxPlainText(scopePath)
          await composer.click()
          await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
          await page.keyboard.press('Backspace')
          await openWorkbenchWorkspaceFile(runtime, 'selection-scope.docx')
          await selectText(page, 1, 0, 1, selectedParagraph.length)
          await page.getByTestId('docx-selection-thought').fill('精简下')
          await page.getByTestId('docx-selection-save').click()
          const scopeStartedAt = Date.now()
          await submitWorkbenchCurrentDraft(page)
          await waitForWorkbenchAiRunCompletion(
            runtime,
            scopeStartedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
          )
          const scopeAfter = await readDocxPlainText(scopePath)
          const [unchangedPrefix, unchangedSuffix] = scopeBefore.split(selectedParagraph)
          const replacementLength =
            scopeAfter.length - unchangedPrefix.length - unchangedSuffix.length
          const selectionOnlyChanged =
            scopeAfter.startsWith(unchangedPrefix) &&
            scopeAfter.endsWith(unchangedSuffix) &&
            replacementLength > 0 &&
            replacementLength < selectedParagraph.length
          const scopeModeToggle = getWorkbenchLocator(page, workbenchSelectors.documentModeToggle)
          await scopeModeToggle.waitFor({ state: 'visible', timeout: 30_000 })
          const scopePreviewPreserved =
            (
              await getWorkbenchLocator(page, workbenchSelectors.documentModeTag).textContent()
            )?.trim() === '预览'
          await scopeModeToggle.click()
          await page.waitForFunction(
            (testId) =>
              document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() === '审核',
            workbenchSelectors.documentModeTag
          )
          await runtime.captureScreenshot({
            name: 'selection-scope-review',
            message: '实际局部改写只精简选中段，普通 DOCX 预览自动关联审核入口'
          })

          return {
            excerpt,
            actionUi,
            inputUi,
            multilineUi,
            multilineText,
            escapeCancelled,
            outsideCancelled,
            tokenIcon,
            highlightedQuote,
            blankHover,
            adjacentHighlights,
            adjacentThought,
            flippedUi,
            resizedUi,
            resizedText,
            emptyDisabled,
            label,
            synchronized,
            located,
            repeatedThought,
            count,
            submittedHighlights,
            historyText,
            historyLabel,
            repeatedUi,
            overlapUi,
            overlappingReferenceCount,
            otherPartnerEmpty,
            memoryRestored,
            cellQuote,
            atomicDeleted,
            crossCellQuote,
            resetLabel,
            nextDraftLabel,
            frozenHistoryLabel,
            historyRestored,
            storedSelections,
            restartedText,
            restartedSelections,
            selectionOnlyChanged,
            scopePreviewPreserved
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.selectionOnlyChanged && result.scopePreviewPreserved, {
            name: 'selection-local-edit-and-live-review',
            message: '仅输入“精简下”应只改选中段，并保持普通预览直到用户切换到审核。',
            data: {
              selectionOnlyChanged: result.selectionOnlyChanged,
              scopePreviewPreserved: result.scopePreviewPreserved
            }
          })
          await runtime.assertThat(
            Boolean(result.excerpt?.includes('客户周会纪要\n会议背景')) &&
              result.emptyDisabled &&
              result.label === '客户周会纪要.docx · 1' &&
              result.synchronized &&
              result.located.includes('客户周会纪要') &&
              result.count === 1 &&
              result.repeatedThought?.includes('风险控制建议') === true &&
              result.submittedHighlights.quotes.length === 0 &&
              result.historyLabel === '客户周会纪要.docx · 1' &&
              !result.repeatedUi.popup &&
              !result.repeatedUi.overlapNotice &&
              result.repeatedUi.selected === result.located &&
              !result.overlapUi.popup &&
              !result.overlapUi.overlapNotice &&
              result.overlapUi.selected.startsWith(result.located) &&
              result.overlapUi.selected.length > result.located.length &&
              result.overlappingReferenceCount === 1 &&
              result.otherPartnerEmpty &&
              result.memoryRestored &&
              result.cellQuote === '模式' &&
              result.atomicDeleted &&
              result.crossCellQuote === '模式\t核心驱动' &&
              result.resetLabel === '人工智能探究课堂PRD.docx · 1' &&
              result.nextDraftLabel === '客户周会纪要.docx · 1' &&
              result.frozenHistoryLabel === result.historyLabel &&
              result.historyRestored &&
              result.storedSelections === 0 &&
              result.restartedSelections === 0 &&
              result.restartedText?.includes('sample-edit.docx') === true &&
              result.restartedText.includes('保留普通草稿。'),
            {
              name: 'docx-selection-reference-real-flow',
              message: '跨段落选区、双向编辑、定位、重复选择和成功提交清理应通过真实 UI 完成。',
              data: result
            }
          )
          await runtime.assertThat(
            !result.actionUi.editorVisible &&
              result.actionUi.withinViewport &&
              result.inputUi.focused &&
              result.inputUi.quote === result.actionUi.quote &&
              result.inputUi.background === 'rgb(219, 197, 246)' &&
              result.inputUi.decoration === 'none' &&
              result.inputUi.placeholder === '描述你想对引用内容做什么' &&
              result.inputUi.confirmIcon &&
              result.inputUi.confirmLabel === '添加到输入框' &&
              result.inputUi.fontSize === '13px' &&
              result.inputUi.lineHeight === '20px' &&
              result.inputUi.height <= 38 &&
              result.multilineText === '第一行\n第二行' &&
              result.multilineUi.height > result.inputUi.height &&
              result.escapeCancelled &&
              result.outsideCancelled &&
              result.tokenIcon &&
              result.highlightedQuote.numberCount === 0 &&
              result.highlightedQuote.quotes.length === 1 &&
              result.blankHover.cursor !== 'pointer' &&
              !result.blankHover.quote &&
              result.adjacentHighlights.quotes.length === 2 &&
              result.adjacentThought === '临时相邻引用' &&
              result.flippedUi.placement === 'above' &&
              result.flippedUi.withinViewport &&
              result.resizedUi.withinViewport &&
              result.resizedText === '缩放保留此输入',
            {
              name: 'docx-selection-edit-ui',
              message: 'AI 引用入口、紧凑输入条、可点击的紫色高亮与碰撞翻转应符合真实预览布局。',
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
