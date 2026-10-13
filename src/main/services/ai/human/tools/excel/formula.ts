import UniverCore from '@univerjs/core/lib/cjs/index.js'
import UniverFacade from '@univerjs/core/lib/cjs/facade.js'
import UniverEngine from '@univerjs/engine-formula/lib/cjs/index.js'
import UniverSheets from '@univerjs/sheets/lib/cjs/index.js'
import UniverSheetsFormula from '@univerjs/sheets-formula/lib/cjs/index.js'
import '@univerjs/engine-formula/lib/cjs/facade.js'
import '@univerjs/sheets/lib/cjs/facade.js'
import '@univerjs/sheets-formula/lib/cjs/facade.js'
import type ExcelJS from 'exceljs'
import type {} from '@univerjs/engine-formula/facade'
import type {} from '@univerjs/sheets/facade'
import type {} from '@univerjs/sheets-formula/facade'
import {
  excelSheetId,
  hasExcelFormulas,
  toExcelWorkbookData
} from '../../../../../../shared/excelWorkbook'

/** Calculate the real source workbook before review rows/columns are aligned. */
export const calculateExcelFormulas = async (workbook: ExcelJS.Workbook): Promise<void> => {
  const data = toExcelWorkbookData(workbook, 'Excel review source')
  if (!hasExcelFormulas(data)) return

  const { Univer, LocaleType, LogLevel, CellValueType } = UniverCore
  const { FUniver } = UniverFacade
  const { UniverFormulaEnginePlugin } = UniverEngine
  const { UniverSheetsPlugin } = UniverSheets
  const { UniverSheetsFormulaPlugin, CalculationMode } = UniverSheetsFormula

  const univer = new Univer({ locale: LocaleType.ZH_CN, logLevel: LogLevel.ERROR })
  try {
    univer.registerPlugin(UniverFormulaEnginePlugin)
    univer.registerPlugin(UniverSheetsPlugin)
    univer.registerPlugin(UniverSheetsFormulaPlugin, {
      initialFormulaComputing: CalculationMode.NO_CALCULATION
    })
    const api = FUniver.newAPI(univer)
    const calculated = api.createWorkbook(data)
    const formula = api.getFormula()
    const applied = formula.onCalculationResultApplied(30_000)
    formula.executeCalculation()
    await applied
    const snapshot = calculated.save()
    workbook.eachSheet((sheet) => {
      const cells = snapshot.sheets[excelSheetId(sheet)].cellData
      sheet.eachRow((row, rowNumber) => {
        row.eachCell((cell, columnNumber) => {
          const value = cell.value
          if (!value || typeof value !== 'object') return
          if (!('formula' in value) && !('sharedFormula' in value)) return
          const calculatedCell = cells?.[rowNumber - 1]?.[columnNumber - 1]
          const result =
            calculatedCell?.t === CellValueType.BOOLEAN
              ? Boolean(calculatedCell.v)
              : calculatedCell?.v
          cell.value = { ...value, result: result ?? undefined }
        })
      })
    })
  } finally {
    univer.dispose()
  }
}
