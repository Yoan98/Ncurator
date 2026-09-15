import { useEffect, useRef, useState } from 'react'
import type { DocRendererProps, IDocument } from 'react-doc-viewer'
import ExcelJS from 'exceljs'
import {
  BooleanNumber,
  BorderStyleTypes,
  CellValueType,
  HorizontalAlign,
  LocaleType,
  VerticalAlign,
  WrapStrategy,
  type ICellData,
  type IStyleData,
  type IWorkbookData,
  type IWorksheetData
} from '@univerjs/core'
import '@univerjs/preset-sheets-core/lib/index.css'
import { workbenchSelectors } from '../../testing/selectors'

type XlsxDocument = Omit<IDocument, 'fileData'> & {
  file?: File | Blob
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
}

const readBytes = async (document: XlsxDocument): Promise<ArrayBuffer> => {
  if (document.file instanceof Blob) return document.file.arrayBuffer()
  if (document.fileData instanceof Blob) return document.fileData.arrayBuffer()
  if (document.fileData instanceof ArrayBuffer) return document.fileData
  if (document.fileData instanceof Uint8Array) return document.fileData.slice().buffer
  if (document.uri) {
    const response = await fetch(document.uri)
    if (!response.ok) throw new Error(`读取 Excel 失败（${response.status}）`)
    return response.arrayBuffer()
  }
  throw new Error('缺少 Excel 预览数据')
}

const DIFF_MARKER_RGB = new Set(['#22A06B', '#D14343'])

const color = (input?: Partial<ExcelJS.Color>): { rgb: string } | undefined => {
  const argb = input?.argb
  if (!argb) return undefined
  return { rgb: `#${argb.slice(-6)}` }
}

const isDiffMarkerColor = (input?: Partial<ExcelJS.Color>): boolean => {
  const rgb = color(input)?.rgb
  return Boolean(rgb && DIFF_MARKER_RGB.has(rgb.toUpperCase()))
}

const cellHasDiffMarkerBorder = (cell: ExcelJS.Cell): boolean => {
  const border = cell.border
  if (!border) return false
  return [border.top, border.right, border.bottom, border.left].some(
    (side) => side?.style === 'medium' && isDiffMarkerColor(side.color)
  )
}

const sheetHasDiffMarker = (sheet: ExcelJS.Worksheet): boolean => {
  if (isDiffMarkerColor(sheet.properties.tabColor)) return true
  let found = false
  sheet.eachRow({ includeEmpty: true }, (row) => {
    if (found) return
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (!found && cellHasDiffMarkerBorder(cell)) found = true
    })
  })
  return found
}

const sheetPreviewId = (sheet: ExcelJS.Worksheet): string => `sheet-${String(sheet.id)}`

const escapeCssIdent = (value: string): string => {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value)
  return value.replace(/([^\w-])/g, '\\$1')
}

const changedSheetDotStyle = (sheetIds: string[]): string => {
  if (sheetIds.length === 0) return ''
  return sheetIds
    .map((id) => {
      const selector = `[data-testid="${workbenchSelectors.excelViewer}"] [data-u-comp="slide-tab-item"][data-id="${escapeCssIdent(id)}"]`
      return `${selector}{position:relative;overflow:visible;}
${selector}::after{content:"";position:absolute;top:2px;right:2px;width:6px;height:6px;border-radius:50%;background:#22A06B;box-shadow:0 0 0 1px #fff;pointer-events:none;}`
    })
    .join('')
}

const borderStyle = (
  side?: Partial<ExcelJS.Border>
): { s: BorderStyleTypes; cl: { rgb: string } } | undefined => {
  if (!side?.style) return undefined
  const styles: Partial<Record<ExcelJS.BorderStyle, BorderStyleTypes>> = {
    thin: BorderStyleTypes.THIN,
    medium: BorderStyleTypes.MEDIUM,
    thick: BorderStyleTypes.THICK,
    double: BorderStyleTypes.DOUBLE,
    dotted: BorderStyleTypes.DOTTED,
    dashed: BorderStyleTypes.DASHED,
    dashDot: BorderStyleTypes.DASH_DOT,
    dashDotDot: BorderStyleTypes.DASH_DOT_DOT,
    hair: BorderStyleTypes.HAIR
  }
  return {
    s: styles[side.style] || BorderStyleTypes.THIN,
    cl: color(side.color) || { rgb: '#D9D9D9' }
  }
}

const cellStyle = (cell: ExcelJS.Cell): IStyleData => ({
  ff: cell.font?.name || undefined,
  fs: cell.font?.size,
  bl: cell.font?.bold ? BooleanNumber.TRUE : BooleanNumber.FALSE,
  it: cell.font?.italic ? BooleanNumber.TRUE : BooleanNumber.FALSE,
  cl: color(cell.font?.color),
  bg: cell.fill?.type === 'pattern' && cell.fill.fgColor ? color(cell.fill.fgColor) : undefined,
  n: cell.numFmt && cell.numFmt !== 'General' ? { pattern: cell.numFmt } : undefined,
  ht:
    cell.alignment?.horizontal === 'center'
      ? HorizontalAlign.CENTER
      : cell.alignment?.horizontal === 'right'
        ? HorizontalAlign.RIGHT
        : cell.alignment?.horizontal === 'left'
          ? HorizontalAlign.LEFT
          : undefined,
  vt:
    cell.alignment?.vertical === 'middle'
      ? VerticalAlign.MIDDLE
      : cell.alignment?.vertical === 'bottom'
        ? VerticalAlign.BOTTOM
        : cell.alignment?.vertical === 'top'
          ? VerticalAlign.TOP
          : undefined,
  tb: cell.alignment?.wrapText ? WrapStrategy.WRAP : undefined,
  bd: {
    t: borderStyle(cell.border?.top),
    r: borderStyle(cell.border?.right),
    b: borderStyle(cell.border?.bottom),
    l: borderStyle(cell.border?.left)
  }
})

const cellData = (cell: ExcelJS.Cell): ICellData => {
  const formula =
    cell.value && typeof cell.value === 'object' && 'formula' in cell.value
      ? String(cell.value.formula)
      : undefined
  const rawValue = formula
    ? cell.result
    : cell.value instanceof Date
      ? cell.value.toISOString()
      : cell.value
  const value =
    typeof rawValue === 'string' || typeof rawValue === 'number' || typeof rawValue === 'boolean'
      ? rawValue
      : rawValue == null
        ? undefined
        : cell.text
  return {
    v: value,
    f: formula ? `=${formula}` : undefined,
    t:
      typeof value === 'number'
        ? CellValueType.NUMBER
        : typeof value === 'boolean'
          ? CellValueType.BOOLEAN
          : CellValueType.STRING,
    s: cellStyle(cell)
  }
}

type ExcelPreviewWorkbook = {
  data: IWorkbookData
  changedSheetIds: string[]
  changedSheetNames: string[]
}

const toWorkbookData = async (bytes: ArrayBuffer, name: string): Promise<ExcelPreviewWorkbook> => {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(bytes as never)
  const sheets: Record<string, Partial<IWorksheetData>> = {}
  const sheetOrder: string[] = []
  const changedSheetIds: string[] = []
  const changedSheetNames: string[] = []
  workbook.eachSheet((sheet) => {
    const id = sheetPreviewId(sheet)
    sheetOrder.push(id)
    if (sheetHasDiffMarker(sheet)) {
      changedSheetIds.push(id)
      changedSheetNames.push(sheet.name)
    }
    const cells: Record<number, Record<number, ICellData>> = {}
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
        ;(cells[rowNumber - 1] ||= {})[columnNumber - 1] = cellData(cell)
      })
    })
    const rowData: Record<number, { h: number }> = {}
    sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (row.height) rowData[rowNumber - 1] = { h: Math.round(row.height * 1.333) }
    })
    const columnData: Record<number, { w: number }> = {}
    for (let index = 1; index <= Math.max(1, sheet.columnCount); index += 1) {
      const width = sheet.getColumn(index).width
      if (width) columnData[index - 1] = { w: Math.round(width * 7) }
    }
    const mergeData = (sheet.model.merges || []).map((range) => {
      const parsed = sheet.getCell(range.split(':')[0])
      const end = sheet.getCell(range.split(':')[1] || range.split(':')[0])
      return {
        startRow: Number(parsed.row) - 1,
        startColumn: Number(parsed.col) - 1,
        endRow: Number(end.row) - 1,
        endColumn: Number(end.col) - 1
      }
    })
    sheets[id] = {
      id,
      name: sheet.name,
      tabColor: color(sheet.properties.tabColor)?.rgb || '',
      hidden: sheet.state === 'visible' ? BooleanNumber.FALSE : BooleanNumber.TRUE,
      rowCount: Math.max(100, sheet.rowCount + 20),
      columnCount: Math.max(26, sheet.columnCount + 10),
      cellData: cells,
      rowData,
      columnData,
      mergeData,
      showGridlines: BooleanNumber.TRUE,
      rightToLeft: BooleanNumber.FALSE
    }
  })
  if (sheetOrder.length === 0) throw new Error('工作簿没有可预览的工作表')
  return {
    data: {
      id: `xlsx-${Date.now().toString(36)}`,
      name,
      appVersion: '1.0.0',
      locale: LocaleType.ZH_CN,
      styles: {},
      sheetOrder,
      sheets
    },
    changedSheetIds,
    changedSheetNames
  }
}

const withReadOnlySheetUi = (options: unknown): unknown => ({
  ...((options && typeof options === 'object' ? options : {}) as Record<string, unknown>),
  disableEdit: true
})

const waitForRenderedCanvas = async (
  container: HTMLDivElement,
  isCancelled: () => boolean
): Promise<boolean> => {
  for (let attempt = 0; attempt < 300 && !isCancelled(); attempt += 1) {
    if (container.querySelector('canvas')) return true
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
  return false
}

const CustomXlsxRenderer = ({ mainState }: DocRendererProps) => {
  const document = mainState.currentDocument as XlsxDocument | undefined
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [changedSheetIds, setChangedSheetIds] = useState<string[]>([])
  const [changedSheetNames, setChangedSheetNames] = useState<string[]>([])

  useEffect(() => {
    if (!document || !containerRef.current) return
    const container = containerRef.current
    let cancelled = false
    let dispose: (() => void) | undefined
    setReady(false)
    setError(null)
    setChangedSheetIds([])
    setChangedSheetNames([])
    void Promise.all([
      readBytes(document).then((bytes) => toWorkbookData(bytes, document.fileName || 'Excel')),
      import('@univerjs/core'),
      import('@univerjs/core/facade'),
      import('@univerjs/preset-sheets-core'),
      import('@univerjs/preset-sheets-core/locales/zh-CN')
    ])
      .then(
        async ([
          preview,
          { Univer, LogLevel },
          { FUniver },
          { UniverSheetsCorePreset },
          localeModule
        ]) => {
          if (cancelled) return
          const univer = new Univer({
            logLevel: LogLevel.WARN,
            locale: LocaleType.ZH_CN,
            locales: { [LocaleType.ZH_CN]: localeModule.default }
          })
          const sheetPreviewOptions: Record<string, unknown> = {
            protectedRangeShadow: 'none',
            disableForceStringAlert: true
          }
          const preset = UniverSheetsCorePreset({
            container,
            header: false,
            toolbar: false,
            formulaBar: true,
            footer: {
              sheetBar: true,
              zoomSlider: true,
              addSheetButtonConfig: { show: false }
            },
            contextMenu: false,
            disableAutoFocus: true,
            sheets: sheetPreviewOptions
          })
          for (const entry of preset.plugins) {
            const [plugin, options] = Array.isArray(entry) ? entry : [entry, undefined]
            const pluginName =
              plugin && typeof plugin === 'function' && 'pluginName' in plugin
                ? String((plugin as { pluginName?: unknown }).pluginName)
                : ''
            univer.registerPlugin(
              plugin,
              pluginName === 'SHEET_UI_PLUGIN' ? withReadOnlySheetUi(options) : options
            )
          }
          const univerAPI = FUniver.newAPI(univer)
          univerAPI.createWorkbook(preview.data)
          dispose = () => univer.dispose()
          if (cancelled) {
            dispose()
            return
          }
          const canvasReady = await waitForRenderedCanvas(container, () => cancelled)
          if (!cancelled && !canvasReady) throw new Error('Excel 预览画布加载超时')
          if (!cancelled) {
            setChangedSheetIds(preview.changedSheetIds)
            setChangedSheetNames(preview.changedSheetNames)
            setReady(true)
          }
        }
      )
      .catch((reason) => {
        if (!cancelled) {
          setReady(false)
          setChangedSheetIds([])
          setChangedSheetNames([])
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
    return () => {
      cancelled = true
      dispose?.()
      container.innerHTML = ''
    }
  }, [document])

  if (!document) return null
  const sheetDotCss = changedSheetDotStyle(changedSheetIds)
  return (
    <div
      className="relative h-full w-full bg-white"
      data-testid={workbenchSelectors.excelViewer}
      data-excel-ready={ready ? 'true' : 'false'}
      data-excel-file-name={document.fileName || ''}
      data-excel-uri={document.uri || ''}
      data-excel-changed-sheets={JSON.stringify(changedSheetNames)}
    >
      {sheetDotCss ? <style>{sheetDotCss}</style> : null}
      {error ? (
        <div className="flex h-full items-center justify-center text-sm text-[#787774]">
          Excel 预览失败：{error}
        </div>
      ) : null}
      <div
        ref={containerRef}
        className="h-full w-full"
        data-testid={workbenchSelectors.excelGrid}
      />
    </div>
  )
}

CustomXlsxRenderer.fileTypes = [
  'xlsx',
  'xlsm',
  'xltx',
  'xltm',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template',
  'application/vnd.ms-excel.template.macroEnabled.12'
]
CustomXlsxRenderer.weight = 1

export default CustomXlsxRenderer
