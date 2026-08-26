import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { afterEach, describe, expect, it } from 'vitest'
import {
  IngestionService,
  isSpreadsheetFilePath,
  isSupportedLocalFilePath
} from '../../../../src/main/services/ingestion/loader'

describe('Excel ingestion boundaries', () => {
  let rootPath = ''

  afterEach(async () => {
    if (rootPath) await fs.rm(rootPath, { recursive: true, force: true })
  })

  it('indexes spreadsheets with metadata only, never cell values', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-ingestion-'))
    const filePath = path.join(rootPath, 'data.xlsx')
    const workbook = new ExcelJS.Workbook()
    workbook.title = '2026年度销售汇总'
    workbook.addWorksheet('季度销售').getCell('A1').value = 'sensitive-cell-value'
    workbook.addWorksheet('客户明细').getCell('A1').value = 'secret-row'
    await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))

    expect(isSpreadsheetFilePath(filePath)).toBe(true)
    expect(isSupportedLocalFilePath(filePath)).toBe(true)

    const docs = await IngestionService.getInstance().loadFile(filePath)
    expect(docs).toHaveLength(1)
    expect(docs[0].pageContent).toContain('data.xlsx')
    expect(docs[0].pageContent).toContain('2026年度销售汇总')
    expect(docs[0].pageContent).toContain('季度销售')
    expect(docs[0].pageContent).toContain('客户明细')
    expect(docs[0].pageContent).not.toContain('sensitive-cell-value')
    expect(docs[0].pageContent).not.toContain('secret-row')
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
