import { describe, it, expect } from 'vitest'
import type { Locator } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  setupWorkbenchWithTempWorkspace,
  openWorkbenchWorkspaceFile,
  workbenchSelectors
} from '../../../../harness/e2e/workbench'
import { writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'

const CASE_ID = 'docx-toolbar-interactions'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

describe('Word toolbar', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: 'Word 工具栏真实查找、选色、格式修改和保存',
        fixtures: [],
        knowledge: 'none',
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const name = '工具栏验收.docx'
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            configureModel: false,
            prepareWorkspace: async (root) => {
              await writeTestDocxFile(root, name, [
                { type: 'paragraph', text: '工具栏验收：课堂与课堂。' },
                { type: 'paragraph', text: 'Case CASE case' },
                { type: 'paragraph', text: '其他段落保留原样。' }
              ])
              await fs.writeFile(path.join(root, '切换文件.txt'), '切换文件以重新打开 Word')
              if (process.platform !== 'win32') {
                await fs.copyFile(path.join(root, name), path.join(root, '只读.docx'))
                await fs.chmod(path.join(root, '只读.docx'), 0o444)
              }
            }
          })
          const filePath = path.join(setup.workspace.rootPath, name)
          const before = await fs.readFile(filePath)
          const read = async () => {
            const zip = await JSZip.loadAsync(await fs.readFile(filePath))
            const xml = await zip.file('word/document.xml')!.async('string')
            const doc = new DOMParser().parseFromString(xml, 'application/xml')
            const value = (node: Element, tag: string, attr = 'val') =>
              node.getElementsByTagNameNS(W, tag)[0]?.getAttributeNS(W, attr)
            const paragraphs = Array.from(doc.getElementsByTagNameNS(W, 'p')).map((p) => ({
              text: Array.from(p.getElementsByTagNameNS(W, 't'))
                .map((n) => n.textContent)
                .join(''),
              alignment: value(p, 'jc') || 'left',
              style: value(p, 'pStyle'),
              indent: value(p, 'ind', 'left') || value(p, 'ind', 'start'),
              line: value(p, 'spacing', 'line'),
              numId: value(p, 'numId'),
              runs: Array.from(p.getElementsByTagNameNS(W, 'r')).map((r) => ({
                text: Array.from(r.getElementsByTagNameNS(W, 't'))
                  .map((n) => n.textContent)
                  .join(''),
                color: value(r, 'color'),
                highlight: value(r, 'highlight'),
                fill: value(r, 'shd', 'fill'),
                font: value(r, 'rFonts', 'eastAsia') || value(r, 'rFonts', 'ascii'),
                size: value(r, 'sz'),
                bold: r.getElementsByTagNameNS(W, 'b').length > 0 && value(r, 'b') !== '0',
                italic: r.getElementsByTagNameNS(W, 'i').length > 0 && value(r, 'i') !== '0',
                underline: value(r, 'u'),
                strike:
                  r.getElementsByTagNameNS(W, 'strike').length > 0 && value(r, 'strike') !== '0'
              }))
            }))
            return { xml, paragraphs }
          }
          const toolbar = page.getByTestId(workbenchSelectors.docxToolbar)
          const paragraph = () =>
            page.locator('.superdoc-page [data-para-id]').filter({ hasText: '工具栏验收' }).first()
          const open = async () => {
            await openWorkbenchWorkspaceFile(runtime, name)
            await page.keyboard.press('Escape')
            await paragraph().waitFor()
            await page.getByTestId(workbenchSelectors.docxLoading).waitFor({ state: 'hidden' })
          }
          await open()
          await paragraph().click()
          // Get real glyph geometry, then select using a real mouse drag.
          const selectRange = async (target: Locator, length: number) => {
            await target.scrollIntoViewIfNeeded()
            const points = await target.evaluate((element, length) => {
              const point = (offset: number) => {
                const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
                while (walker.nextNode()) {
                  const node = walker.currentNode as Text
                  if (offset <= node.length) {
                    const range = document.createRange()
                    range.setStart(node, offset === node.length ? Math.max(0, offset - 1) : offset)
                    range.setEnd(node, Math.min(node.length, offset + 1))
                    const r = range.getBoundingClientRect()
                    return {
                      x: offset === node.length ? r.right - 0.5 : r.left + 0.5,
                      y: r.top + r.height / 2
                    }
                  }
                  offset -= node.length
                }
                throw new Error('Missing test text position')
              }
              return [point(0), point(length)]
            }, length)
            await page.mouse.move(points[0].x, points[0].y)
            await page.mouse.down()
            await page.mouse.move(points[1].x, points[1].y, { steps: 8 })
            await page.mouse.up()
          }
          const selectFirst = () => selectRange(paragraph(), 5)
          const click = (label: string) =>
            toolbar.getByRole('button', { name: label, exact: true }).click()
          const undo = () => click('撤销')
          // Both entry paths must produce one real, focusable input, without the SDK overlay.
          await click('查找')
          const search = toolbar.getByRole('search')
          const query = search.getByRole('textbox', { name: '查找文字' })
          await expect.poll(() => query.evaluate((n) => document.activeElement === n)).toBe(true)
          await query.fill('课堂')
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('1/2')
          await search.getByRole('button', { name: '下一个结果' }).click()
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('2/2')
          await query.press('Shift+Enter')
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('1/2')
          await query.press('Enter')
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('2/2')
          await query.fill('不存在的词')
          await expect
            .poll(() => search.locator('.nc-docx-search-count').innerText())
            .toContain('没有匹配结果')
          await query.fill('case')
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('1/3')
          await search.getByRole('button', { name: '查找选项' }).click()
          await page.getByRole('checkbox', { name: '区分大小写' }).check()
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('1/1')
          await page.getByRole('checkbox', { name: '正则表达式' }).check()
          await query.fill('[')
          await expect
            .poll(() => search.locator('.nc-docx-search-count').innerText())
            .toContain('正则表达式无效')
          await search.getByRole('button', { name: '查找选项' }).click()
          await query.press('Escape')
          await search.waitFor({ state: 'hidden' })
          await paragraph().click()
          await page.keyboard.press('Control+f')
          await query.waitFor()
          await expect.poll(() => query.evaluate((n) => document.activeElement === n)).toBe(true)
          await page.keyboard.press('Meta+f')
          expect(await query.count()).toBe(1)
          expect(await page.locator('.sd-find-replace').count()).toBe(0)
          await query.fill('课堂')
          await expect.poll(() => search.locator('.nc-docx-search-count').innerText()).toBe('1/2')
          expect((await fs.readFile(filePath)).equals(before)).toBe(true)
          await click('替换')
          await search.getByRole('textbox', { name: '替换为' }).fill('教室')
          await search.getByRole('button', { name: '替换', exact: true }).click()
          await expect
            .poll(async () => (await read()).paragraphs[0].text)
            .toBe('工具栏验收：教室与课堂。')
          await undo()
          await expect
            .poll(async () => (await read()).paragraphs[0].text)
            .toBe('工具栏验收：课堂与课堂。')
          await expect
            .poll(() => search.getByRole('button', { name: '全部替换' }).isEnabled())
            .toBe(true)
          await search.getByRole('button', { name: '全部替换' }).click()
          await expect
            .poll(async () => (await read()).paragraphs[0].text)
            .toBe('工具栏验收：教室与教室。')
          await undo()
          await expect
            .poll(async () => (await read()).paragraphs[0].text)
            .toBe('工具栏验收：课堂与课堂。')
          await query.press('Escape')
          // Color changes must affect exactly the selected word, including repeated choices.
          await selectFirst()
          const saved = await fs.readFile(filePath)
          await click('选择高亮颜色')
          let palette = page.getByRole('dialog', { name: '高亮颜色' })
          await palette.waitFor()
          expect((await fs.readFile(filePath)).equals(saved)).toBe(true)
          await toolbar.getByRole('button', { name: '选择高亮颜色', exact: true }).press('Escape')
          await palette.waitFor({ state: 'hidden' })
          await click('选择高亮颜色')
          await palette.getByRole('button', { name: '#FFFF00', exact: true }).click()
          const highlighted = async () =>
            (await read()).paragraphs[0].runs
              .filter((r) => r.highlight === 'yellow' || r.fill === 'FFFF00')
              .map((r) => r.text)
              .join('')
          await expect.poll(highlighted).toBe('工具栏验收')
          await expect
            .poll(() =>
              toolbar
                .getByRole('button', { name: '高亮颜色', exact: true })
                .locator('.nc-docx-color-indicator')
                .evaluate((n) => getComputedStyle(n).backgroundColor)
            )
            .toBe('rgb(255, 255, 0)')
          await click('选择高亮颜色')
          await palette.getByRole('button', { name: '#00FF00', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.highlight === 'green' || r.fill === '00FF00')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await click('选择高亮颜色')
          await palette.getByRole('button', { name: '无颜色', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs.some(
                (r) => (r.highlight && r.highlight !== 'none') || (r.fill && r.fill !== 'auto')
              )
            )
            .toBe(false)
          await click('高亮颜色') // split main button reapplies the last chosen color
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs.some(
                (r) => r.highlight === 'green' || r.fill === '00FF00'
              )
            )
            .toBe(true)
          await undo()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs.some(
                (r) => (r.highlight && r.highlight !== 'none') || (r.fill && r.fill !== 'auto')
              )
            )
            .toBe(false)
          await click('选择高亮颜色')
          await palette.getByRole('button', { name: '自定义颜色…' }).click()
          await palette.getByRole('textbox', { name: '颜色值' }).fill('#ABCDEF')
          await palette.getByRole('button', { name: '应用', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.fill?.toUpperCase() === 'ABCDEF')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await undo()
          await click('选择文字颜色')
          palette = page.getByRole('dialog', { name: '文字颜色' })
          await palette.getByRole('button', { name: '#B3261E', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === 'B3261E')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await click('选择文字颜色')
          await palette.getByRole('button', { name: '自定义颜色…' }).click()
          await palette.getByRole('textbox', { name: '颜色值' }).fill('invalid')
          expect(
            await palette.getByRole('button', { name: '应用', exact: true }).isDisabled()
          ).toBe(true)
          await palette.getByRole('textbox', { name: '颜色值' }).fill('#123ABC')
          await palette.getByRole('button', { name: '应用', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await click('选择文字颜色')
          await palette.getByRole('button', { name: '无颜色', exact: true }).click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('')
          await click('文字颜色')
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          for (const [label, property] of [
            ['加粗', 'bold'],
            ['斜体', 'italic'],
            ['下划线', 'underline'],
            ['删除线', 'strike']
          ] as const) {
            await selectFirst()
            await click(label)
            await expect
              .poll(async () =>
                (await read()).paragraphs[0].runs
                  .filter((r) => Boolean(r[property]))
                  .map((r) => r.text)
                  .join('')
              )
              .toBe('工具栏验收')
            await undo()
          }
          await selectFirst()
          await click('清除格式')
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('')
          await undo()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await selectFirst()
          await click('格式刷')
          await selectRange(
            page
              .locator('.superdoc-page [data-para-id]')
              .filter({ hasText: 'Case CASE case' })
              .first(),
            4
          )
          await expect
            .poll(async () =>
              (await read()).paragraphs[1].runs
                .filter((r) => r.color === '123ABC')
                .map((r) => r.text)
                .join('')
            )
            .toBe('Case')
          await undo()
          await selectFirst()
          await toolbar.locator('.nc-docx-family').click()
          await toolbar.getByRole('combobox', { name: '字体', exact: true }).fill('黑体')
          await page
            .locator('.ant-select-dropdown:visible .ant-select-item-option')
            .filter({ hasText: /^黑体$/ })
            .click()
          await expect
            .poll(async () =>
              (await read()).paragraphs[0].runs
                .filter((r) => r.font === '黑体')
                .map((r) => r.text)
                .join('')
            )
            .toBe('工具栏验收')
          await selectFirst()
          await toolbar.locator('.nc-docx-size').click()
          await toolbar.getByRole('combobox', { name: '字号', exact: true }).fill('19')
          await page.keyboard.press('Enter')
          await expect
            .poll(async () => (await read()).paragraphs[0].runs.some((r) => r.size === '38'))
            .toBe(true)
          await page.keyboard.press('Escape')
          await click('增大字号')
          await expect
            .poll(async () => (await read()).paragraphs[0].runs.some((r) => r.size === '40'))
            .toBe(true)
          await click('减小字号')
          await expect
            .poll(async () => (await read()).paragraphs[0].runs.some((r) => r.size === '36'))
            .toBe(true)
          await undo()
          await undo()
          await expect
            .poll(async () => (await read()).paragraphs[0].runs.some((r) => r.size === '38'))
            .toBe(true)
          await paragraph().click()
          await toolbar.locator('.nc-docx-style-select').click()
          await toolbar.getByRole('combobox', { name: '段落样式', exact: true }).fill('Heading 1')
          await page
            .locator('.ant-select-dropdown:visible .ant-select-item-option')
            .filter({ hasText: /heading 1|标题 ?1/i })
            .first()
            .click()
          await expect.poll(async () => (await read()).paragraphs[0].style).toMatch(/heading1/i)
          await undo()
          await selectFirst()
          await click('格式刷')
          await toolbar.getByRole('button', { name: '格式刷', exact: true }).press('Escape')
          await expect
            .poll(() =>
              toolbar
                .getByRole('button', { name: '格式刷', exact: true })
                .getAttribute('aria-pressed')
            )
            .toBe('false')
          await paragraph().click()
          for (const [label, value] of [
            ['居中', 'center'],
            ['右对齐', 'right'],
            ['两端对齐', 'both'],
            ['左对齐', 'left']
          ]) {
            await click(label)
            await expect.poll(async () => (await read()).paragraphs[0].alignment).toBe(value)
          }
          await click('行距')
          await page.getByRole('menuitem', { name: '行距 1.5', exact: true }).click()
          await expect.poll(async () => (await read()).paragraphs[0].line).toBe('360')
          await click('增加缩进')
          await expect
            .poll(async () => Number((await read()).paragraphs[0].indent || 0))
            .toBeGreaterThan(0)
          await click('减少缩进')
          await expect.poll(async () => Number((await read()).paragraphs[0].indent || 0)).toBe(0)
          await click('项目符号')
          await expect
            .poll(async () => Number((await read()).paragraphs[0].numId || 0))
            .toBeGreaterThan(0)
          await undo()
          await click('编号')
          await expect
            .poll(async () => Number((await read()).paragraphs[0].numId || 0))
            .toBeGreaterThan(0)
          await undo()
          // Reopen the real saved file; pixels and OOXML must agree, not just controller state.
          const tab = page
            .locator(`[data-testid^="${workbenchSelectors.resourceTabPrefix}-"]`)
            .filter({ hasText: name })
          await openWorkbenchWorkspaceFile(runtime, '切换文件.txt')
          await tab.getByRole('button', { name: /^关闭/ }).click()
          await open()
          const titleRun = paragraph()
            .locator('[data-run-id]')
            .filter({ hasText: '工具栏验收' })
            .first()
          await expect
            .poll(() => titleRun.evaluate((n) => getComputedStyle(n).color))
            .toBe('rgb(18, 58, 188)')
          await expect
            .poll(() => titleRun.evaluate((n) => parseFloat(getComputedStyle(n).fontSize)))
            .toBeCloseTo((19 * 96) / 72, 0)
          await runtime.captureScreenshot({
            name: 'word-ribbon-saved-formatting',
            message: '重新打开保留准确文字颜色与字号。'
          })
          const reopenedStyle = (await read()).paragraphs[0].style
          await paragraph().click()
          await toolbar.locator('.nc-docx-style-select').click()
          await toolbar.getByRole('combobox', { name: '段落样式', exact: true }).fill('Heading 1')
          await page
            .locator('.ant-select-dropdown:visible .ant-select-item-option')
            .filter({ hasText: /heading 1|标题 ?1/i })
            .first()
            .click()
          await expect.poll(async () => (await read()).paragraphs[0].style).toMatch(/heading1/i)
          await undo()
          await expect.poll(async () => (await read()).paragraphs[0].style).toBe(reopenedStyle)
          const statusbar = page.locator('.nc-docx-statusbar')
          const zoomText = () => statusbar.locator('.ant-select-selection-item').innerText()
          const originalZoom = Number.parseInt(await zoomText())
          const zoomBytes = await fs.readFile(filePath)
          await statusbar.getByRole('button', { name: '放大', exact: true }).click()
          await expect.poll(zoomText).toBe(`${originalZoom + 10}%`)
          await statusbar.getByRole('button', { name: '缩小', exact: true }).click()
          await expect.poll(zoomText).toBe(`${originalZoom}%`)
          await statusbar.getByRole('button', { name: '适应窗口', exact: true }).click()
          await page.waitForTimeout(600)
          expect(await fs.readFile(filePath)).toEqual(zoomBytes)
          // Drag the actual panel divider; common operations remain visible at each width.
          const shell = page.getByTestId(workbenchSelectors.contentPanelShell)
          await page.getByTestId(workbenchSelectors.sessionsToggle).click()
          for (const width of [900, 520, 360]) {
            // Its hit area is a pseudo-element on a zero-width divider, so
            // measure stable layout before driving the real mouse gesture.
            await page.getByTestId(workbenchSelectors.contentPanelResizer).evaluate(async (el) => {
              let prior = el.getBoundingClientRect().left,
                stable = 0
              for (let frame = 0; frame < 90; frame++) {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                const next = el.getBoundingClientRect().left
                stable = Math.abs(next - prior) < 0.05 ? stable + 1 : 0
                if (stable >= 4) return
                prior = next
              }
              throw new Error('Panel divider did not settle')
            })
            const handle = await page
              .getByTestId(workbenchSelectors.contentPanelResizer)
              .boundingBox()
            if (!handle) throw new Error('Missing panel resize handle')
            const current = await shell.evaluate((el) => el.getBoundingClientRect().width)
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
            await page.mouse.down()
            await page.mouse.move(
              handle.x + handle.width / 2 + current - width,
              handle.y + handle.height / 2,
              { steps: 10 }
            )
            await page.mouse.up()
            await expect
              .poll(() =>
                shell.evaluate(
                  (el, width) => Math.abs(el.getBoundingClientRect().width - width),
                  width
                )
              )
              .toBeLessThan(3)
            if (width === 900)
              await expect
                .poll(() => toolbar.locator('.nc-docx-style-gallery button:visible').count())
                .toBeGreaterThan(0)
            for (const label of [
              '斜体',
              '下划线',
              '居中',
              '选择高亮颜色',
              '选择文字颜色',
              '行距'
            ]) {
              expect(
                await toolbar.getByRole('button', { name: label, exact: true }).isVisible()
              ).toBe(true)
            }
            await selectFirst()
            await click('选择高亮颜色')
            const bounds = await page.getByRole('dialog', { name: '高亮颜色' }).boundingBox()
            const viewport = await page.evaluate(() => ({
              width: window.innerWidth,
              height: window.innerHeight
            }))
            expect(
              bounds && viewport && bounds.x >= 0 && bounds.x + bounds.width <= viewport.width
            ).toBe(true)
            await expect
              .poll(() =>
                page
                  .getByRole('dialog', { name: '高亮颜色' })
                  .evaluate((el) => Number(getComputedStyle(el.closest('.ant-popover')!).opacity))
              )
              .toBe(1)
            await runtime.captureScreenshot({
              name: `word-ribbon-${width}`,
              message: `Word 工具栏与颜色浮层，分栏宽度 ${width}px。`
            })
            await page
              .getByRole('dialog', { name: '高亮颜色' })
              .getByRole('button', { name: width === 520 ? '#00FF00' : '#FFFF00' })
              .click()
            await page.getByRole('dialog', { name: '高亮颜色' }).waitFor({ state: 'hidden' })
            await expect
              .poll(async () =>
                (await read()).paragraphs[0].runs
                  .filter((r) =>
                    width === 520
                      ? r.highlight === 'green' || r.fill === '00FF00'
                      : r.highlight === 'yellow' || r.fill === 'FFFF00'
                  )
                  .map((r) => r.text)
                  .join('')
              )
              .toBe('工具栏验收')
          }
          await runtime.captureScreenshot({
            name: 'word-ribbon-narrow-colors',
            message: '窄分栏常用按钮直接可用，选色准确保存。'
          })
          await click('插入')
          await click('插入表格')
          await page
            .getByRole('dialog', { name: '插入表格' })
            .getByRole('button', { name: /应\s*用/ })
            .click()
          await expect.poll(async () => (await read()).xml).toContain('<w:tbl')
          const cell = page.locator('.superdoc-page [data-sd-cell-id]').first()
          await cell.scrollIntoViewIfNeeded()
          const cellBox = await cell.boundingBox()
          if (!cellBox) throw new Error('Missing painted table cell')
          await page.mouse.click(
            cellBox.x + Math.min(15, cellBox.width / 2),
            cellBox.y + cellBox.height / 2
          )
          await click('表格')
          await click('插入行')
          await page.getByRole('menuitem', { name: '在下方插入行', exact: true }).click()
          await expect
            .poll(async () => {
              const doc = new DOMParser().parseFromString((await read()).xml, 'application/xml')
              return doc.getElementsByTagNameNS(W, 'tr').length
            })
            .toBe(4)
          // Read-only file uses the same search engine without exposing mutation controls.
          if (process.platform !== 'win32') {
            await openWorkbenchWorkspaceFile(runtime, '切换文件.txt')
            const readonly = path.join(setup.workspace.rootPath, '只读.docx')
            const bytes = await fs.readFile(readonly)
            try {
              await openWorkbenchWorkspaceFile(runtime, '只读.docx')
              await page.keyboard.press('Escape')
              await page.getByTestId(workbenchSelectors.docxLoading).waitFor({ state: 'hidden' })
              await page.locator('.superdoc-page').first().waitFor()
              expect(await toolbar.getByRole('button', { name: '加粗', exact: true }).count()).toBe(
                0
              )
              expect(await toolbar.getByRole('button', { name: '替换', exact: true }).count()).toBe(
                0
              )
              await click('查找')
              await query.fill('课堂')
              await expect
                .poll(() => search.locator('.nc-docx-search-count').innerText())
                .toBe('1/2')
              expect(await search.getByRole('textbox', { name: '替换为' }).count()).toBe(0)
              await query.press('Escape')
              expect(await fs.readFile(readonly)).toEqual(bytes)
            } finally {
              await fs.chmod(readonly, 0o644)
            }
          }
          return true
        },
        assert: async (passed, runtime) => {
          await runtime.assertThat(passed, {
            name: 'word-ribbon-search-colors-and-formatting',
            message:
              '查找与快捷键可输入；颜色、格式刷及字体段落操作准确落盘，重开、宽窄分栏、表格和只读查找通过。'
          })
        }
      })
    },
    240_000
  )
})
