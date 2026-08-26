import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IngestionService,
  isSpreadsheetFilePath,
  isSupportedLocalFilePath
} from '../../../../src/main/services/ingestion/loader'

const SALES_FIXTURE_PATH = path.resolve('tests/fixtures/workspace/销售额统计表.xlsx')
const BUDGET_FIXTURE_PATH = path.resolve('tests/fixtures/workspace/预算底稿.xlsm')

describe('Excel ingestion boundaries', () => {
  let rootPath = ''

  afterEach(async () => {
    if (rootPath) await fs.rm(rootPath, { recursive: true, force: true })
  })

  it('indexes shared fixture spreadsheets with metadata only, never cell values', async () => {
    expect(isSpreadsheetFilePath(SALES_FIXTURE_PATH)).toBe(true)
    expect(isSupportedLocalFilePath(SALES_FIXTURE_PATH)).toBe(true)

    const docs = await IngestionService.getInstance().loadFile(SALES_FIXTURE_PATH)
    expect(docs).toHaveLength(1)
    expect(docs[0].pageContent).toContain('销售额统计表.xlsx')
    expect(docs[0].pageContent).toContain('2026年度销售汇总')
    expect(docs[0].pageContent).toContain('季度销售')
    expect(docs[0].pageContent).toContain('客户明细')
    expect(docs[0].pageContent).toContain('产品&分类')
    expect(docs[0].pageContent).not.toContain('cedar-xlsx-cell-secret')
    expect(docs[0].pageContent).not.toContain('cedar-xlsx-sheet-secret')
    expect(docs[0].pageContent).not.toContain('cedar-xlsx-category-secret')
  })

  it('keeps default sheet names and omits title for fixture without docProps title', async () => {
    const docs = await IngestionService.getInstance().loadFile(BUDGET_FIXTURE_PATH)
    expect(docs).toHaveLength(1)
    expect(docs[0].pageContent).toContain('预算底稿.xlsm')
    expect(docs[0].pageContent).toContain('Sheet1')
    expect(docs[0].pageContent).toContain('Sheet2')
    expect(docs[0].pageContent).not.toContain('标题')
    expect(docs[0].pageContent).not.toContain('cedar-xlsm-cell-secret')
  })

  it('fails when the spreadsheet has no readable workbook part', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-ingestion-'))
    const filePath = path.join(rootPath, 'broken.xlsx')
    await fs.writeFile(filePath, 'not a zip at all')
    await expect(IngestionService.getInstance().loadFile(filePath)).rejects.toThrow()
  })

  it('keeps filename and sheet names when docProps/core.xml is missing', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-ingestion-'))
    const filePath = path.join(rootPath, 'minimal.xlsx')
    const zip = new JSZip()
    zip.file(
      'xl/workbook.xml',
      [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        '<sheets>',
        '<sheet name="SheetA" sheetId="1" r:id="rId1"/>',
        '<sheet name="SheetB" sheetId="2" r:id="rId2"/>',
        '</sheets>',
        '</workbook>'
      ].join('')
    )
    await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))

    const docs = await IngestionService.getInstance().loadFile(filePath)
    expect(docs).toHaveLength(1)
    expect(docs[0].pageContent).toContain('minimal.xlsx')
    expect(docs[0].pageContent).toContain('SheetA')
    expect(docs[0].pageContent).toContain('SheetB')
  })

  it.each(['.xlsx', '.xlsm', '.xltx', '.xltm'])(
    'recognizes spreadsheet extension %s',
    (extension) => {
      expect(isSpreadsheetFilePath(`report${extension}`)).toBe(true)
    }
  )
})
