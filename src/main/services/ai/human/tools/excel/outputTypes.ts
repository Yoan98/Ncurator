export type ExcelRangeCellOutput =
  | string
  | number
  | boolean
  | null
  | {
      formula: string
      value?: string | number | boolean | null
    }

export type ExcelStyleCellOutput = null | {
  bold?: boolean
  fontColor?: string
  fillColor?: string
  numberFormat?: string
}

export type ExcelReadWorkbookOutput = {
  sheets: Array<{
    name: string
    range: string | null
    rowCount: number
    columnCount: number
  }>
}

export type ExcelReadRangeOutput = {
  sheetName: string
  range: string
  rows: ExcelRangeCellOutput[][]
}

export type ExcelReadStyleOutput = {
  sheetName: string
  range: string
  rows: ExcelStyleCellOutput[][]
}

export type ExcelSearchOutput = {
  totalMatchCount: number
  returnedMatchCount: number
  matches: Array<{
    sheetName: string
    address: string
    value?: string | number | boolean | null
    formula?: string
  }>
}

export type ExcelReadOutput =
  | ExcelReadWorkbookOutput
  | ExcelReadRangeOutput
  | ExcelReadStyleOutput
  | ExcelSearchOutput

export type ExcelEditOutput = Record<string, never>
