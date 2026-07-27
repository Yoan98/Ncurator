import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
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

  it('recognizes spreadsheets without treating them as knowledge-base files', async () => {
    rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-excel-ingestion-'))
    const filePath = path.join(rootPath, 'data.xlsx')
    const workbook = new ExcelJS.Workbook()
    workbook.addWorksheet('Data').getCell('A1').value = 'sensitive'
    await fs.writeFile(filePath, Buffer.from(await workbook.xlsx.writeBuffer()))

    expect(isSpreadsheetFilePath(filePath)).toBe(true)
    expect(isSupportedLocalFilePath(filePath)).toBe(false)
    await expect(IngestionService.getInstance().loadFile(filePath)).rejects.toThrow(
      'Unsupported file type'
    )
  })

  it.each(['.xlsx', '.xlsm', '.xltx', '.xltm'])(
    'recognizes spreadsheet extension %s',
    (extension) => {
      expect(isSpreadsheetFilePath(`report${extension}`)).toBe(true)
    }
  )
})
