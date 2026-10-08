import { describe, it } from 'vitest'
import type { Page } from 'playwright'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
  assertNoWorkbenchFakeSignals,
  createPartnerThroughWorkbenchUi,
  insertWorkbenchReferenceToken,
  navigateToWorkbench,
  getWorkbenchLocator,
  openWorkbenchWorkspaceFile,
  setupWorkbenchWithTempWorkspace,
  submitWorkbenchCurrentDraft,
  waitForWorkbenchAiRunCompletion,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'

const CASE_ID = 'docx-selection-reference'
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
  const bounds = await page
    .locator('.docx-content')
    .first()
    .evaluate(
      (article, input) => {
        const paragraphs = [...article.querySelectorAll(input.selector)]
        const point = (paragraphIndex: number, offset: number) => {
          const walker = document.createTreeWalker(paragraphs[paragraphIndex], NodeFilter.SHOW_TEXT)
          let node = walker.nextNode()
          while (node instanceof Text) {
            if (offset <= node.length) {
              const range = document.createRange()
              range.setStart(node, Math.max(0, offset === node.length ? offset - 1 : offset))
              range.setEnd(
                node,
                Math.min(node.length, offset === node.length ? offset : offset + 1)
              )
              const rect = range.getBoundingClientRect()
              return {
                x: offset === node.length ? rect.right - 0.5 : rect.left + 0.5,
                y: rect.top + rect.height / 2
              }
            }
            offset -= node.length
            node = walker.nextNode()
          }
          throw new Error('文本位置不存在')
        }
        return {
          start: point(input.startParagraph, input.start),
          end: point(input.endParagraph, input.end)
        }
      },
      { startParagraph, start, endParagraph, end, selector: options.selector || 'article p' }
    )
  await page.mouse.click(bounds.start.x, bounds.start.y)
  await page.keyboard.down('Shift')
  try {
    await page.mouse.click(bounds.end.x, bounds.end.y)
  } finally {
    await page.keyboard.up('Shift')
  }
  if (options.popup !== false) {
    await page.getByTestId('docx-selection-ai-edit').waitFor({ state: 'visible' })
    if (options.editor !== false) {
      await page.getByTestId('docx-selection-ai-edit').click()
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

const markersAvoidText = (page: Page) =>
  page.evaluate(() => {
    const viewer = document.querySelector('.docx-content')!
    const rects: DOMRect[] = []
    const range = document.createRange()
    for (const paragraph of viewer.querySelectorAll('article p')) {
      const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        range.selectNodeContents(node)
        rects.push(...range.getClientRects())
        node = walker.nextNode()
      }
    }
    const markers = [...document.querySelectorAll('[data-testid="docx-selection-marker"]')]
    return (
      markers.length > 0 &&
      markers.every((marker) => {
        const badge = marker.getBoundingClientRect()
        return !rects.some(
          (text) =>
            badge.left < text.right &&
            text.left < badge.right &&
            badge.top < text.bottom &&
            text.top < badge.bottom
        )
      })
    )
  })

const observeMarkerAnchors = (page: Page) =>
  page.evaluate(() => {
    const ranges = [...CSS.highlights]
      .filter(([key]) => !key.endsWith('-active'))
      .flatMap(([, highlight]) => [...highlight])
      .filter((item): item is Range => item instanceof Range)
    return [...document.querySelectorAll('[data-testid="docx-selection-marker"]')].map(
      (marker, index) => {
        const range = ranges[index]
        if (!(range?.endContainer instanceof Text) || !range.endOffset)
          throw new Error('选区末字不存在')
        const glyph = document.createRange()
        glyph.setStart(range.endContainer, range.endOffset - 1)
        glyph.setEnd(range.endContainer, range.endOffset)
        const end = glyph.getBoundingClientRect()
        const badge = marker.getBoundingClientRect()
        return {
          number: marker.textContent,
          width: badge.width,
          height: badge.height,
          horizontalDistance: badge.left + badge.width / 2 - end.right,
          verticalDistance: badge.bottom - end.top
        }
      }
    )
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
        execution: 'live',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
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
          for (const selection of [
            { start: 0, end: 5, thought: '第一段' },
            { start: 6, end: 10, thought: '第二段' },
            { start: 11, end: 18, thought: '第三段' }
          ]) {
            await selectText(page, 0, selection.start, 0, selection.end)
            await page.getByTestId('docx-selection-thought').fill(selection.thought)
            await page.getByRole('button', { name: '添加到输入框', exact: true }).click()
          }
          const superscripts = await observeMarkerAnchors(page)
          await runtime.assertThat(
            superscripts.length === 3 &&
              superscripts.every(
                (marker) =>
                  marker.width <= 16 &&
                  marker.height <= 16 &&
                  Math.abs(marker.horizontalDistance) <= 20 &&
                  marker.verticalDistance <= 1 &&
                  marker.verticalDistance >= -20
              ) &&
              (await markersAvoidText(page)),
            {
              name: 'selection-superscript-near-last-glyph',
              message: '部分单词的编号应紧贴末字上方，包含点击区域在内不遮挡正文。',
              data: superscripts
            }
          )
          await page.getByTestId('docx-selection-marker').nth(1).click()
          const editConfirmLabel = (await observeSelectionUi(page)).confirmLabel
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
          const afterMiddleDelete = await readDraftSelections()
          const afterMiddleMarkers = await page
            .getByTestId('docx-selection-marker')
            .allTextContents()
          await runtime.assertThat(
            afterMiddleDelete[0]?.label === 'sample-edit.docx · 1' &&
              afterMiddleDelete[0].quote === 'Hello' &&
              afterMiddleDelete[0].thought === '第一段' &&
              afterMiddleDelete[1]?.label === 'sample-edit.docx · 2' &&
              afterMiddleDelete[1].quote === 'fixture' &&
              afterMiddleDelete[1].thought === '第三段' &&
              afterMiddleMarkers.join(',') === '1,2' &&
              editConfirmLabel === '确认修改',
            {
              name: 'selection-popup-delete-renumbers-both-sides',
              message: '删除中间引用后两侧连续编号，原文和想法保持关联。',
              data: { afterMiddleDelete, afterMiddleMarkers, editConfirmLabel }
            }
          )
          await composer
            .locator('[data-role="document-selection-thought"]')
            .first()
            .click({ position: { x: 0.5, y: 8 } })
          await page.keyboard.press('Backspace')
          const afterComposerDelete = await readDraftSelections()
          const afterComposerMarkers = await page
            .getByTestId('docx-selection-marker')
            .allTextContents()
          await runtime.assertThat(
            afterComposerDelete.length === 1 &&
              afterComposerDelete[0]?.label === 'sample-edit.docx · 1' &&
              afterComposerDelete[0].quote === 'fixture' &&
              afterComposerDelete[0].thought === '第三段' &&
              afterComposerMarkers.join(',') === '1',
            {
              name: 'selection-composer-delete-renumbers-both-sides',
              message: '输入区直接删除引用后剩余编号同步重排，内容保持关联。',
              data: { afterComposerDelete, afterComposerMarkers }
            }
          )
          await composer.fill('')
          await selectText(page, 0, 0, 0, 5)
          await page.getByTestId('docx-selection-thought').fill('重新添加')
          await page.getByTestId('docx-selection-save').click()
          const afterClear = await readDraftSelections()
          const afterClearMarker = await page.getByTestId('docx-selection-marker').textContent()
          await runtime.assertThat(
            afterClear[0]?.label === 'sample-edit.docx · 1' && afterClearMarker === '1',
            {
              name: 'selection-clear-restarts-at-one',
              message: '删除全部引用后再次添加从 1 开始。',
              data: { afterClear, afterClearMarker }
            }
          )
          await page.getByTestId('docx-selection-marker').click()
          await runtime.captureScreenshot({
            name: 'selection-compact-confirm',
            message: '末字上标编号、对勾确认输入条与左侧引用'
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
          await runtime.captureScreenshot({
            name: 'selection-action',
            message: '紫色选区与 AI 编辑入口'
          })
          await page.getByTestId('docx-selection-ai-edit').click()
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
          const markerClear = await markersAvoidText(page)
          await selectText(page, 1, 8, 1, 16)
          await page.getByTestId('docx-selection-thought').fill('临时相邻引用')
          await page.getByTestId('docx-selection-save').click()
          const adjacentMarkersClear =
            (await page.getByTestId('docx-selection-marker').count()) === 2 &&
            (await markersAvoidText(page))
          await page.getByTestId('docx-selection-marker').last().click()
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
          const locatedMarkerUi = await page.evaluate(() => {
            const range = [...CSS.highlights]
              .filter(([key]) => !key.endsWith('-active'))
              .flatMap(([, highlight]) => [...highlight])
              .find((item): item is Range => item instanceof Range)
            const viewer = document.querySelector('.docx-content')!
            const bounds = (rect: DOMRect) => ({
              left: rect.left,
              right: rect.right,
              top: rect.top,
              bottom: rect.bottom
            })
            return {
              markerCount: document.querySelectorAll('[data-testid="docx-selection-marker"]')
                .length,
              viewport: bounds(viewer.getBoundingClientRect()),
              selection: range ? [...range.getClientRects()].map(bounds) : [],
              text: [...viewer.querySelectorAll('article p')].slice(0, 3).map((paragraph) => {
                const content = document.createRange()
                content.selectNodeContents(paragraph)
                return [...content.getClientRects()].map(bounds)
              })
            }
          })
          await runtime.assertThat(locatedMarkerUi.markerCount === 1, {
            name: 'selection-marker-after-locating',
            message: '跨段落引用定位后应展示末字编号。',
            data: locatedMarkerUi
          })
          await page.getByTestId('docx-selection-marker').click()
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
          await selectText(page, 0, 0, 1, 8)
          const repeatedThought = await page.getByTestId('docx-selection-thought').textContent()
          await page.getByTestId('docx-selection-thought').press('Escape')
          const count = await composer.locator('[data-role="document-selection-token"]').count()
          await selectText(page, 0, 0, 1, 12, { popup: false })
          await page.getByText('该选区与已有编号重叠，请调整选取范围。', { exact: true }).waitFor()
          const overlapRejected = (await page.getByTestId('docx-selection-popup').count()) === 0
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
          await selectText(page, 0, 0, 1, 4, { selector: 'article td p', popup: false })
          await page
            .getByText('请选择正文中的连续文本；表格仅支持单个单元格。', { exact: true })
            .waitFor()
          const crossCellRejected = (await page.getByTestId('docx-selection-popup').count()) === 0
          await selectText(page, 0, 0, 0, 2, { selector: 'article td p' })
          await page.getByTestId('docx-selection-thought').fill('临时引用。')
          await page.getByTestId('docx-selection-save').click()
          const resetLabel = await composer
            .locator('[data-role="document-selection-token"]')
            .last()
            .getAttribute('aria-label')
          await page.getByTestId('docx-selection-marker').click()
          await page.getByRole('button', { name: '删除引用', exact: true }).click()
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
          const markerCount = await page.getByTestId('docx-selection-marker').count()
          await waitForWorkbenchAiRunCompletion(
            runtime,
            startedAt,
            setup.env.modelName,
            WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS,
            { page, blockerPolicy: 'auto_approve' }
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
          await page.getByTestId('docx-selection-marker').click()
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

          return {
            excerpt,
            actionUi,
            inputUi,
            multilineUi,
            multilineText,
            escapeCancelled,
            outsideCancelled,
            tokenIcon,
            markerClear,
            adjacentMarkersClear,
            flippedUi,
            resizedUi,
            resizedText,
            emptyDisabled,
            label,
            synchronized,
            located,
            repeatedThought,
            count,
            markerCount,
            historyText,
            historyLabel,
            overlapRejected,
            otherPartnerEmpty,
            memoryRestored,
            cellQuote,
            atomicDeleted,
            crossCellRejected,
            resetLabel,
            nextDraftLabel,
            frozenHistoryLabel,
            historyRestored,
            storedSelections,
            restartedText,
            restartedSelections
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            Boolean(result.excerpt?.includes('客户周会纪要\n会议背景')) &&
              result.emptyDisabled &&
              result.label === '客户周会纪要.docx · 1' &&
              result.synchronized &&
              result.located.includes('客户周会纪要') &&
              result.count === 1 &&
              result.repeatedThought?.includes('风险控制建议') === true &&
              result.markerCount === 0 &&
              result.historyLabel === '客户周会纪要.docx · 1' &&
              result.overlapRejected &&
              result.otherPartnerEmpty &&
              result.memoryRestored &&
              result.cellQuote === '模式' &&
              result.atomicDeleted &&
              result.crossCellRejected &&
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
              result.inputUi.placeholder === '描述编辑内容' &&
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
              result.markerClear &&
              result.adjacentMarkersClear &&
              result.flippedUi.placement === 'above' &&
              result.flippedUi.withinViewport &&
              result.resizedUi.withinViewport &&
              result.resizedText === '缩放保留此输入',
            {
              name: 'docx-selection-edit-ui',
              message: 'AI 编辑入口、紧凑输入条、紫色高亮、碰撞翻转与编号避让应符合真实预览布局。',
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
