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
  options: { selector?: string; popup?: boolean } = {}
) => {
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
  await page.mouse.move(bounds.start.x, bounds.start.y)
  await page.mouse.down()
  await page.mouse.move(bounds.end.x, bounds.end.y, { steps: 12 })
  await page.mouse.up()
  if (options.popup !== false)
    await page.getByTestId('docx-selection-popup').waitFor({ state: 'visible' })
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
        description: '通过真实鼠标选区和键盘操作验证混合正文同步、定位及提交清理。',
        fixtures: ['tests/fixtures/workspace'],
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'live',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, { caseId: CASE_ID })
          await openWorkbenchWorkspaceFile(runtime, '工作/客户周会纪要.docx')
          await page
            .locator('.docx-content article p')
            .first()
            .waitFor({ state: 'visible', timeout: 30_000 })
          await selectText(page, 0, 0, 1, 8)
          const excerpt = await page
            .getByTestId('docx-selection-popup')
            .locator('.whitespace-pre-wrap')
            .first()
            .textContent()
          await runtime.captureScreenshot({
            name: 'selection-popup',
            message: 'DOCX 跨段落原文与想法输入框'
          })
          const emptyDisabled = await page.getByTestId('docx-selection-save').isDisabled()
          await page
            .getByTestId('docx-selection-thought')
            .fill('请解释这段的关键约束，无需修改文件。')
          await page.getByTestId('docx-selection-thought').press('Enter')
          const composer = getWorkbenchLocator(page, workbenchSelectors.input)
          await composer.locator('[data-role="document-selection-token"]').waitFor()
          const label = await composer
            .locator('[data-role="document-selection-token"]')
            .textContent()
          await composer.locator('[data-role="document-selection-thought"]').click()
          await page.keyboard.press('End')
          await page.keyboard.type(' 重点说明谨慎表述。')
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
          const cellQuote = await page
            .getByTestId('docx-selection-popup')
            .locator('.whitespace-pre-wrap')
            .first()
            .textContent()
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
          const monotonicLabel = await composer
            .locator('[data-role="document-selection-token"]')
            .last()
            .textContent()
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
            emptyDisabled,
            label,
            synchronized,
            located,
            repeatedThought,
            count,
            markerCount,
            historyText,
            overlapRejected,
            otherPartnerEmpty,
            memoryRestored,
            cellQuote,
            atomicDeleted,
            crossCellRejected,
            monotonicLabel,
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
              result.label === '[客户周会纪要.docx · 1]' &&
              result.synchronized &&
              result.located.includes('客户周会纪要') &&
              result.count === 1 &&
              result.repeatedThought?.includes('风险控制建议') === true &&
              result.markerCount === 0 &&
              result.historyText?.includes('[客户周会纪要.docx · 1]') === true &&
              result.overlapRejected &&
              result.otherPartnerEmpty &&
              result.memoryRestored &&
              result.cellQuote === '模式' &&
              result.atomicDeleted &&
              result.crossCellRejected &&
              result.monotonicLabel === '[人工智能探究课堂PRD.docx · 2]' &&
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
          await assertNoWorkbenchFakeSignals(runtime)
        }
      })
    },
    WORKBENCH_LIVE_AI_E2E_TIMEOUT_MS
  )
})
