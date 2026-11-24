import JSZip from 'jszip'
import ExcelJS from 'exceljs'
import {
  BorderStyleTypes,
  HorizontalAlign,
  VerticalAlign,
  WrapStrategy,
  type IColorStyle,
  type ICellData,
  type IStyleData,
  type IWorkbookData
} from '@univerjs/core'

/** ExcelJS cannot round-trip these objects; keep their source files read-only. */
export async function canPreserveExcelWorkbook(bytes: Uint8Array): Promise<boolean> {
  const zip = await JSZip.loadAsync(bytes)
  return !Object.keys(zip.files).some(
    (name) =>
      /^xl\/(?:charts|chartsheets|pivotTables|pivotCache|slicers|slicerCaches|activeX|ctrlProps|externalLinks|queryTables)\//i.test(
        name
      ) ||
      /^xl\/vbaProject\.bin$/i.test(name) ||
      /^_xmlsignatures\//i.test(name)
  )
}

const equal = (
  a: object | string | number | boolean | null | void,
  b: object | string | number | boolean | null | void
) => JSON.stringify(a) === JSON.stringify(b)
const styleFor = (cell: ICellData | undefined, data: IWorkbookData): IStyleData =>
  typeof cell?.s === 'string' ? data.styles?.[cell.s] || {} : cell?.s || {}
const argb = (
  color?: Pick<IColorStyle, 'rgb'> | null | void
): Partial<ExcelJS.Color> | undefined => {
  const rgb = color?.rgb?.replace('#', '')
  return rgb && /^[\da-f]{6,8}$/i.test(rgb)
    ? { argb: rgb.length === 6 ? 'FF' + rgb : rgb }
    : undefined
}
function applyStyle(cell: ExcelJS.Cell, before: IStyleData, after: IStyleData) {
  const changed = (key: keyof IStyleData) => !equal(before[key], after[key])
  const font = { ...cell.font }
  if (changed('ff')) font.name = after.ff || undefined
  if (changed('fs')) font.size = after.fs || undefined
  if (changed('bl')) font.bold = Boolean(after.bl)
  if (changed('it')) font.italic = Boolean(after.it)
  if (changed('ul')) font.underline = Boolean(after.ul?.s)
  if (changed('st')) font.strike = Boolean(after.st?.s)
  if (changed('cl')) font.color = argb(after.cl)
  cell.font = font
  if (changed('bg'))
    cell.fill = after.bg
      ? { type: 'pattern', pattern: 'solid', fgColor: argb(after.bg) }
      : { type: 'pattern', pattern: 'none' }
  if (changed('n')) cell.numFmt = after.n?.pattern || 'General'
  const alignment = { ...cell.alignment }
  if (changed('ht'))
    alignment.horizontal = !after.ht
      ? undefined
      : after.ht === HorizontalAlign.CENTER
        ? 'center'
        : after.ht === HorizontalAlign.RIGHT
          ? 'right'
          : after.ht === HorizontalAlign.JUSTIFIED
            ? 'justify'
            : 'left'
  if (changed('vt'))
    alignment.vertical = !after.vt
      ? undefined
      : after.vt === VerticalAlign.TOP
        ? 'top'
        : after.vt === VerticalAlign.MIDDLE
          ? 'middle'
          : 'bottom'
  if (changed('tb')) alignment.wrapText = after.tb === WrapStrategy.WRAP
  if (changed('tr')) alignment.textRotation = after.tr?.a || 0
  cell.alignment = alignment
  if (changed('bd')) {
    const border = { ...cell.border }
    const styles: Partial<Record<BorderStyleTypes, ExcelJS.BorderStyle>> = {
      [BorderStyleTypes.THIN]: 'thin',
      [BorderStyleTypes.MEDIUM]: 'medium',
      [BorderStyleTypes.THICK]: 'thick',
      [BorderStyleTypes.DOUBLE]: 'double',
      [BorderStyleTypes.DOTTED]: 'dotted',
      [BorderStyleTypes.DASHED]: 'dashed',
      [BorderStyleTypes.DASH_DOT]: 'dashDot',
      [BorderStyleTypes.DASH_DOT_DOT]: 'dashDotDot',
      [BorderStyleTypes.HAIR]: 'hair'
    }
    for (const [key, side] of [
      ['t', 'top'],
      ['b', 'bottom'],
      ['l', 'left'],
      ['r', 'right']
    ] as const) {
      const value = after.bd?.[key]
      if (!equal(before.bd?.[key], value))
        border[side] = value
          ? { style: styles[value.s] || 'thin', color: argb(value.cl) }
          : undefined
    }
    cell.border = border
  }
}

/** Apply the edited grid to the original workbook, retaining untouched rich values and metadata. */
export async function exportExcelEdits(
  bytes: Uint8Array,
  before: IWorkbookData,
  after: IWorkbookData
): Promise<Uint8Array> {
  if (!after.sheetOrder?.length || after.sheetOrder.some((id) => !after.sheets[id]))
    throw new Error('A workbook must contain at least one worksheet')
  if (!(await canPreserveExcelWorkbook(bytes)))
    throw new Error(
      'This workbook contains unsupported Office objects and is read-only in the built-in editor'
    )
  const names = after.sheetOrder.map((id) => after.sheets[id].name)
  if (new Set(names.map((name) => (name || '').toLowerCase())).size !== names.length)
    throw new Error('Worksheet names must be unique')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(Buffer.from(bytes) as never)
  const existing = new Map(
    before.sheetOrder.flatMap((id) => {
      const sheet = workbook.getWorksheet(before.sheets[id]?.name || '')
      return sheet ? [[id, sheet] as const] : []
    })
  )
  for (const [id, sheet] of existing) if (!after.sheets[id]) workbook.removeWorksheet(sheet.id)
  // Temporary names allow valid swaps and delete-then-rename without name collisions.
  let temporary = 0
  for (const [id, sheet] of existing)
    if (after.sheets[id]) {
      let name: string
      do {
        name = `__ncurator_${++temporary}`
      } while (workbook.getWorksheet(name) || names.includes(name))
      sheet.name = name
    }
  const ordered: ExcelJS.Worksheet[] = []
  for (const id of after.sheetOrder) {
    const current = after.sheets[id],
      previous = before.sheets[id]
    const sheet = existing.get(id) || workbook.addWorksheet(current.name)
    sheet.name = current.name || 'Sheet'
    ordered.push(sheet)
    if (!equal(previous?.hidden, current.hidden))
      sheet.state = current.hidden ? 'hidden' : 'visible'
    if (!equal(previous?.tabColor, current.tabColor))
      sheet.properties.tabColor = argb({ rgb: current.tabColor }) as ExcelJS.Color
    const oldMerges = previous?.mergeData || [],
      newMerges = current.mergeData || []
    if (!equal(oldMerges, newMerges))
      for (const range of [...(sheet.model.merges || [])]) sheet.unMergeCells(range)
    const rows = new Set([
      ...Object.keys(previous?.cellData || {}),
      ...Object.keys(current.cellData || {})
    ])
    for (const row of rows) {
      const rowIndex = Number(row)
      const oldRow = previous?.cellData?.[rowIndex] || {},
        newRow = current.cellData?.[rowIndex] || {}
      for (const col of new Set([...Object.keys(oldRow), ...Object.keys(newRow)])) {
        const column = Number(col),
          oldCell = oldRow[column],
          newCell = newRow[column]
        const cell = sheet.getCell(rowIndex + 1, column + 1)
        if (cell.isMerged && cell.master.address !== cell.address) continue
        const oldText = oldCell?.p?.body?.dataStream,
          newText = newCell?.p?.body?.dataStream
        const valueChanged =
          oldCell?.f !== newCell?.f ||
          (!newCell?.f && (!equal(oldCell?.v, newCell?.v) || oldText !== newText))
        if (valueChanged || (newCell?.f && !equal(oldCell?.v, newCell.v))) {
          if (newCell?.f)
            cell.value = {
              formula: newCell.f.replace(/^=/, ''),
              result:
                typeof newCell.v === 'string' ||
                typeof newCell.v === 'number' ||
                typeof newCell.v === 'boolean'
                  ? newCell.v
                  : undefined
            }
          else if (newText !== undefined)
            cell.value = newText.endsWith('\r\n') ? newText.slice(0, -2) : newText
          else cell.value = newCell?.v ?? null
        }
        const oldStyle = styleFor(oldCell, before),
          newStyle = styleFor(newCell, after)
        if (!equal(oldStyle, newStyle)) applyStyle(cell, oldStyle, newStyle)
      }
    }
    for (const key of new Set([
      ...Object.keys(previous?.rowData || {}),
      ...Object.keys(current.rowData || {})
    ])) {
      const index = Number(key),
        old = previous?.rowData?.[index],
        next = current.rowData?.[index]
      if (!equal(old, next)) {
        const row = sheet.getRow(index + 1)
        if (next?.h) row.height = next.h / 1.333
        else Reflect.deleteProperty(row, 'height')
        row.hidden = Boolean(next?.hd)
      }
    }
    for (const key of new Set([
      ...Object.keys(previous?.columnData || {}),
      ...Object.keys(current.columnData || {})
    ])) {
      const index = Number(key),
        old = previous?.columnData?.[index],
        next = current.columnData?.[index]
      if (!equal(old, next)) {
        const col = sheet.getColumn(index + 1)
        if (next?.w) col.width = next.w / 7
        else Reflect.deleteProperty(col, 'width')
        col.hidden = Boolean(next?.hd)
      }
    }
    if (!equal(oldMerges, newMerges))
      for (const merge of newMerges)
        sheet.mergeCells(
          merge.startRow + 1,
          merge.startColumn + 1,
          merge.endRow + 1,
          merge.endColumn + 1
        )
    if (!equal(previous?.freeze, current.freeze)) {
      const freeze = current.freeze
      sheet.views =
        freeze && (freeze.xSplit || freeze.ySplit)
          ? [{ state: 'frozen', xSplit: freeze.xSplit, ySplit: freeze.ySplit }]
          : [{ state: 'normal' }]
    }
  }
  // ExcelJS sorts exported worksheets by orderNo; its declaration omits this runtime property.
  ordered.forEach((sheet, index) => Reflect.set(sheet, 'orderNo', index))
  workbook.calcProperties.fullCalcOnLoad = true
  return new Uint8Array(await workbook.xlsx.writeBuffer())
}
