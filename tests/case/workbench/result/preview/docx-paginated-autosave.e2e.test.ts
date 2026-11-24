import ExcelJS from 'exceljs'
import { clickExcelCell } from '../../../../harness/e2e/excel'
import { describe, it, expect } from 'vitest'
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

const CASE_ID = 'docx-paginated-autosave'
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const NATIVE_COMMENTS =
  '.comments-list, .comment-placeholder, .comments-dialog, .superdoc__right-sidebar, .superdoc__compact-comment-popover'
const readNativeReview = async (bytes: Buffer) => {
  const zip = await JSZip.loadAsync(bytes)
  const parse = async (part: string) =>
    new DOMParser().parseFromString(await zip.file(part)!.async('string'), 'application/xml')
  const doc = await parse('word/document.xml')
  const text = (node: Element, tag: string) =>
    Array.from(node.getElementsByTagNameNS(W, tag))
      .map((e) => e.textContent)
      .join('')
  const comments = Array.from(
    (await parse('word/comments.xml')).getElementsByTagNameNS(W, 'comment')
  ).map((c) => ({ author: c.getAttributeNS(W, 'author'), text: text(c, 't') }))
  const revisions = ['ins', 'del', 'moveFrom', 'moveTo', 'rPrChange', 'pPrChange'].flatMap((kind) =>
    Array.from(doc.getElementsByTagNameNS(W, kind)).map((node) => ({
      kind,
      text: text(node, 't') + text(node, 'delText')
    }))
  )
  return { comments, revisions }
}
describe('Word editor', () => {
  it(
    CASE_ID,
    async () => {
      await runE2ECase({
        caseId: CASE_ID,
        domain: 'workbench',
        suite: 'result',
        groups: ['preview'],
        description: '分页编辑、自动保存和冲突恢复',
        fixtures: ['tests/fixtures/workspace/合同审阅.docx'],
        knowledge: 'none',
        serviceMode: 'real',
        windowMode: 'visible',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const setup = await setupWorkbenchWithTempWorkspace(page, {
            caseId: CASE_ID,
            workspaceContents: 'empty',
            configureModel: false,
            prepareWorkspace: async (root) => {
              await fs.copyFile(
                path.resolve('tests/fixtures/workspace/合同审阅.docx'),
                path.join(root, '合同审阅.docx')
              )
            }
          })
          const name = 'sample-edit.docx',
            filePath = path.join(setup.workspace.rootPath, name)
          const real = process.env.DOCX_QA_SOURCE
          if (real) await fs.copyFile(real, filePath)
          else
            await writeTestDocxFile(
              setup.workspace.rootPath,
              name,
              Array.from({ length: 120 }, (_, i) => ({ type: 'paragraph', text: '分页编辑 ' + i }))
            )
          const before = await fs.readFile(filePath)
          const prematureLoad = await page.evaluate(() =>
            performance
              .getEntriesByType('resource')
              .some((e) => e.name.includes('/superdoc/editor.js'))
          )
          expect(prematureLoad).toBe(false)
          await page.context().setOffline(true)
          const loading = page.getByTestId(workbenchSelectors.docxLoading)
          const loadingShown = loading.waitFor({ state: 'visible' }).then(async () => {
            expect(await loading.textContent()).toContain('正在打开 Word 文档')
          })
          await openWorkbenchWorkspaceFile(runtime, name)
          await loadingShown
          await page.keyboard.press('Escape')
          const paragraph = page.locator('.superdoc-page [data-run-id]').first()
          await paragraph.waitFor({ state: 'visible' })
          await loading.waitFor({ state: 'hidden' })
          const toolbar = page.getByTestId(workbenchSelectors.docxToolbar)
          await toolbar.getByRole('toolbar').waitFor({ state: 'visible' })
          expect(await toolbar.getByRole('button', { name: /保存|Save/ }).count()).toBe(0)
          expect(await page.locator(NATIVE_COMMENTS).count()).toBe(0)
          await expect
            .poll(() => page.locator('.superdoc-page').count(), { timeout: 10000 })
            .toBeGreaterThan(1)
          await paragraph.click()
          await page.keyboard.press('Shift+ArrowRight')
          await page.waitForTimeout(600)
          expect(await page.locator(NATIVE_COMMENTS).count()).toBe(0)
          await page.keyboard.press('ArrowRight')
          expect((await fs.readFile(filePath)).equals(before)).toBe(true)
          const readXml = async () =>
            await (await JSZip.loadAsync(await fs.readFile(filePath)))
              .file('word/document.xml')!
              .async('string')
          const alignment = async () => {
            const doc = new DOMParser().parseFromString(await readXml(), 'application/xml')
            const first = doc.getElementsByTagNameNS(W, 'p')[0]!
            return first.getElementsByTagNameNS(W, 'jc')[0]?.getAttributeNS(W, 'val') || 'left'
          }
          const clickToolbar = (item: string) =>
            toolbar.locator(`[data-item="btn-${item}"]`).click()
          const originalAlignment = await alignment()
          await toolbar.getByRole('button', { name: '居中', exact: true }).click()
          await expect.poll(alignment, { timeout: 10000 }).toBe('center')
          await clickToolbar('undo')
          await expect.poll(alignment).toBe(originalAlignment)
          await clickToolbar('redo')
          await expect.poll(alignment).toBe('center')
          await clickToolbar('undo')
          await expect.poll(alignment).toBe(originalAlignment)
          await paragraph.click()
          await page.keyboard.press('Shift+ArrowRight')
          const fontSize = toolbar.getByRole('combobox', { name: '字号', exact: true })
          await toolbar
            .locator('.ant-select')
            .filter({ has: page.getByRole('combobox', { name: '字号', exact: true }) })
            .click()
          await fontSize.fill('18')
          await fontSize.press('Enter')
          await expect.poll(readXml, { timeout: 10000 }).toMatch(/w:sz[^>]*w:val="36"/)
          await clickToolbar('undo')
          await paragraph.click()
          await page.keyboard.press('ArrowRight')
          await toolbar.getByRole('button', { name: '插入', exact: true }).click()
          await toolbar.getByRole('button', { name: '插入表格', exact: true }).click()
          const tableDialog = page.getByRole('dialog', { name: '插入表格' })
          await tableDialog.getByRole('button', { name: /应\s*用/ }).click()
          await expect.poll(readXml, { timeout: 10000 }).toContain('<w:tbl')
          await clickToolbar('undo')
          await expect.poll(readXml, { timeout: 10000 }).not.toContain('<w:tbl')
          await paragraph.click()
          await page.keyboard.insertText('分页自动保存甲')
          await page.keyboard.insertText('乙')
          await expect.poll(readXml, { timeout: 10000 }).toContain('分页自动保存甲乙')
          if (real)
            await fs.copyFile(
              filePath,
              path.join(process.env.TMPDIR || '/tmp', 'ncurator-workbench-save.docx')
            )
          if (process.platform !== 'win32') {
            const originalMode = (await fs.stat(filePath)).mode
            const savedBytes = await fs.readFile(filePath)
            try {
              await fs.chmod(filePath, 0o444)
              await page.keyboard.insertText('写入重试')
              await page.getByRole('alert').getByRole('button', { name: '重试' }).waitFor()
              expect(await fs.readFile(filePath)).toEqual(savedBytes)
            } finally {
              await fs.chmod(filePath, originalMode)
            }
            await page.getByRole('button', { name: '重试' }).click()
            await expect.poll(readXml).toContain('写入重试')
            await paragraph.click()
          }
          await page.keyboard.insertText('未保存')
          await fs.writeFile(filePath, before)
          await page.getByRole('button', { name: '另存副本' }).waitFor()
          expect((await fs.readFile(filePath)).equals(before)).toBe(true)
          await page.getByRole('button', { name: '打开最新版本' }).click()
          await paragraph.waitFor({ state: 'visible' })
          expect((await page.locator('.superdoc-page').allTextContents()).join('')).not.toContain(
            '未保存'
          )
          const middle = page
            .locator('.superdoc-page [data-para-id]')
            .filter({ hasText: '分页编辑 70' })
            .first()
          let middleOffset = 0
          if (!real) {
            await middle.scrollIntoViewIfNeeded()
            await page.waitForTimeout(100)
            middleOffset = await middle.evaluate(
              (el) =>
                el.getBoundingClientRect().top -
                el.closest('.docx-content')!.getBoundingClientRect().top
            )
          }
          const external = await JSZip.loadAsync(before)
          const externalXml = await external.file('word/document.xml')!.async('string')
          external.file(
            'word/document.xml',
            externalXml
              .replace('</w:t>', '外部空闲修改</w:t>')
              .replace(
                '<w:body>',
                '<w:body>' +
                  Array.from(
                    { length: 40 },
                    (_, i) => `<w:p><w:r><w:t>新增前置段落 ${i}</w:t></w:r></w:p>`
                  ).join('')
              )
          )
          await fs.writeFile(filePath, await external.generateAsync({ type: 'nodebuffer' }))
          await page
            .locator('.superdoc-page [data-para-id]')
            .filter({ hasText: '外部空闲修改' })
            .first()
            .waitFor()
          if (!real)
            await expect
              .poll(
                async () =>
                  Math.abs(
                    (await middle.evaluate(
                      (el) =>
                        el.getBoundingClientRect().top -
                        el.closest('.docx-content')!.getBoundingClientRect().top
                    )) - middleOffset
                  ),
                { timeout: 10000 }
              )
              .toBeLessThan(6)
          const reviewPath = path.join(setup.workspace.rootPath, '合同审阅.docx')
          const annotations = await readNativeReview(await fs.readFile(reviewPath))
          expect(annotations.comments).toHaveLength(52)
          await openWorkbenchWorkspaceFile(runtime, '合同审阅.docx')
          await page.keyboard.press('Escape')
          const last = page
            .locator('.superdoc-page [data-para-id]')
            .filter({ hasText: '附件核对项48' })
            .last()
          await last.waitFor({ state: 'visible' })
          await loading.waitFor({ state: 'hidden' })
          await last.click()
          await page.keyboard.insertText('人工编辑保留批注修订')
          await expect
            .poll(
              async () => {
                const zip = await JSZip.loadAsync(await fs.readFile(reviewPath))
                return zip.file('word/document.xml')!.async('string')
              },
              { timeout: 10000 }
            )
            .toContain('人工编辑保留批注修订')
          expect(await readNativeReview(await fs.readFile(reviewPath))).toEqual(annotations)
          expect(await page.locator(NATIVE_COMMENTS).count()).toBe(0)
          await runtime.captureScreenshot({
            name: 'docx-toolbar-and-hidden-comments',
            message: '普通 Word 工具栏可操作，原生批注界面关闭且文件审阅记录保留。'
          })
          const excelPath = path.join(setup.workspace.rootPath, '手动编辑.xlsx')
          const workbook = new ExcelJS.Workbook(),
            sheet = workbook.addWorksheet('Data')
          sheet.getCell('A1').value = '手动编辑验证'
          sheet.getCell('B2').value = 10
          sheet.getCell('C2').value = { formula: 'B2*2', result: 20 }
          await workbook.xlsx.writeFile(excelPath)
          const originalExcel = await fs.readFile(excelPath)
          await openWorkbenchWorkspaceFile(runtime, '手动编辑.xlsx')
          await page.keyboard.press('Escape')
          const excelViewer = page.getByTestId(workbenchSelectors.excelViewer)
          await page.waitForFunction(
            (id) =>
              document.querySelector(`[data-testid="${id}"]`)?.getAttribute('data-excel-ready') ===
              'true',
            workbenchSelectors.excelViewer
          )
          expect((await fs.readFile(excelPath)).equals(originalExcel)).toBe(true)
          await clickExcelCell(page, 'B2')
          await page.keyboard.type('35')
          await page.keyboard.press('Enter')
          const readCell = async (address: string) => {
            const book = new ExcelJS.Workbook()
            await book.xlsx.load((await fs.readFile(excelPath)) as never)
            return book.worksheets[0].getCell(address).value
          }
          await expect.poll(() => readCell('B2'), { timeout: 15000 }).toBe(35)
          await clickExcelCell(page, 'D2')
          await page.keyboard.type('=B2+5')
          await page.keyboard.press('Enter')
          await expect
            .poll(
              async () => {
                const cell = await readCell('D2')
                return cell && typeof cell === 'object' && 'formula' in cell ? cell.formula : null
              },
              { timeout: 15000 }
            )
            .toBe('B2+5')
          await page.keyboard.press('ControlOrMeta+z')
          await expect.poll(() => readCell('D2'), { timeout: 10000 }).toBe(null)
          await page.keyboard.press('ControlOrMeta+y')
          await expect
            .poll(
              async () => {
                const cell = await readCell('D2')
                return cell && typeof cell === 'object' && 'formula' in cell ? cell.formula : null
              },
              { timeout: 10000 }
            )
            .toBe('B2+5')
          expect(await excelViewer.getByRole('button', { name: /^保存$|^Save$/ }).count()).toBe(0)
          await runtime.captureScreenshot({
            name: 'excel-manual-edit',
            message: '真实 Excel 网格直接编辑和公式自动保存。'
          })
          const beforeBrowsing = await fs.readFile(excelPath)
          await clickExcelCell(page, 'A1')
          await page.mouse.wheel(0, 450)
          await page.waitForTimeout(700)
          expect((await fs.readFile(excelPath)).equals(beforeBrowsing)).toBe(true)
          await excelViewer.locator('[data-u-comp="defined-name"] input').fill('B2')
          await excelViewer.locator('[data-u-comp="defined-name"] input').press('Enter')
          await page.keyboard.type('67')
          await page.keyboard.press('Enter')
          await fs.writeFile(excelPath, originalExcel)
          await excelViewer.getByRole('button', { name: '另存副本' }).waitFor()
          expect((await fs.readFile(excelPath)).equals(originalExcel)).toBe(true)
          await excelViewer.getByRole('button', { name: '打开最新版本' }).click()
          await expect.poll(() => excelViewer.getAttribute('data-excel-ready')).toBe('true')
          await expect.poll(() => readCell('B2')).toBe(10)
          const nameBox = excelViewer.locator('[data-u-comp="defined-name"] input')
          await nameBox.fill('A50')
          await nameBox.press('Enter')
          await page.waitForTimeout(100)
          const externalExcel = new ExcelJS.Workbook()
          await externalExcel.xlsx.load((await fs.readFile(excelPath)) as never)
          externalExcel.getWorksheet('Data')!.getCell('A50').value = '外部刷新位置'
          const refreshing = page
            .getByText('检测到当前文件被外部修改，已自动刷新', { exact: true })
            .waitFor({ state: 'visible' })
          await externalExcel.xlsx.writeFile(excelPath)
          await refreshing
          await expect.poll(() => nameBox.inputValue(), { timeout: 10000 }).toBe('A50')
          await nameBox.press('Enter')
          await page.keyboard.press('ControlOrMeta+c')
          await expect
            .poll(async () => runtime.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
            .toContain('外部刷新位置')

          const damaged = Buffer.from('invalid DOCX input')
          await fs.writeFile(filePath, damaged)
          await openWorkbenchWorkspaceFile(runtime, name)
          await page.keyboard.press('Escape')
          const retry = page
            .getByTestId(workbenchSelectors.docxViewer)
            .getByRole('button', { name: '重试' })
          await retry.waitFor({ state: 'visible', timeout: 10000 })
          await loading.waitFor({ state: 'hidden' })
          expect(await fs.readFile(filePath)).toEqual(damaged)
          return true
        },
        assert: async (passed, runtime) => {
          await runtime.assertThat(passed, {
            name: 'paginated-autosave-conflict',
            message: '实际按页显示、输入自动写盘、静态打开不写盘，冲突时保留磁盘内容并可恢复。'
          })
        }
      })
    },
    180000
  )
})
