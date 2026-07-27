import { useEffect, useMemo, useState } from 'react'
import type { DocRendererProps, IDocument } from 'react-doc-viewer'
import JSZip from 'jszip'
import { workbenchSelectors } from '../../testing/selectors'

type XlsxDocument = Omit<IDocument, 'fileData'> & {
  file?: File | Blob
  fileData?: string | ArrayBuffer | Uint8Array | Blob | File
  fileName?: string
}

type XlsxCell = { address: string; value: string; formula?: string; border?: 'green' | 'red' }
type XlsxSheet = { name: string; cells: XlsxCell[]; maxRow: number; maxColumn: number }

const localElements = (root: Document | Element, name: string): Element[] =>
  Array.from(root.getElementsByTagNameNS('*', name))

const textContent = (element: Element | null): string =>
  element
    ? Array.from(element.getElementsByTagNameNS('*', 't'))
        .map((item) => item.textContent || '')
        .join('')
    : ''

const columnNumber = (address: string): number => {
  const letters = address.match(/^[A-Za-z]+/)?.[0] || 'A'
  return letters
    .toUpperCase()
    .split('')
    .reduce((total, letter) => total * 26 + letter.charCodeAt(0) - 64, 0)
}

const rowNumber = (address: string): number => Number(address.match(/\d+/)?.[0] || 1)

const columnLetters = (column: number): string => {
  let value = column
  let result = ''
  while (value > 0) {
    const remainder = (value - 1) % 26
    result = String.fromCharCode(65 + remainder) + result
    value = Math.floor((value - 1) / 26)
  }
  return result
}

const readBytes = async (document: XlsxDocument): Promise<ArrayBuffer> => {
  if (document.file instanceof Blob) return await document.file.arrayBuffer()
  if (document.fileData instanceof Blob) return await document.fileData.arrayBuffer()
  if (document.fileData instanceof ArrayBuffer) return document.fileData
  if (document.fileData instanceof Uint8Array) {
    const copy = new Uint8Array(document.fileData.byteLength)
    copy.set(document.fileData)
    return copy.buffer
  }
  if (document.uri) {
    const response = await fetch(document.uri)
    if (!response.ok) throw new Error(`读取 Excel 失败（${response.status}）`)
    return await response.arrayBuffer()
  }
  throw new Error('缺少 Excel 预览数据')
}

const parseWorkbook = async (bytes: ArrayBuffer): Promise<XlsxSheet[]> => {
  const zip = await JSZip.loadAsync(bytes)
  const xml = async (fileName: string): Promise<Document> =>
    new DOMParser().parseFromString(await zip.file(fileName)!.async('text'), 'application/xml')
  const workbook = await xml('xl/workbook.xml')
  const rels = await xml('xl/_rels/workbook.xml.rels')
  const relMap = new Map(
    localElements(rels, 'Relationship').map((item) => [
      item.getAttribute('Id') || '',
      item.getAttribute('Target') || ''
    ])
  )
  const sharedStrings = zip.file('xl/sharedStrings.xml')
    ? localElements(await xml('xl/sharedStrings.xml'), 'si').map((item) => textContent(item))
    : []
  const styleBorders = new Map<number, 'green' | 'red'>()
  if (zip.file('xl/styles.xml')) {
    const styles = await xml('xl/styles.xml')
    const borders = localElements(styles, 'border').map((border) => {
      const colors = localElements(border, 'color').map((color) =>
        (color.getAttribute('rgb') || '').toUpperCase()
      )
      return colors.some((color) => color.endsWith('22A06B'))
        ? 'green'
        : colors.some((color) => color.endsWith('D14343'))
          ? 'red'
          : undefined
    })
    const cellXfsRoot = localElements(styles, 'cellXfs')[0]
    const cellXfs = cellXfsRoot ? localElements(cellXfsRoot, 'xf') : []
    cellXfs.forEach((xf, index) => {
      const borderId = Number(xf.getAttribute('borderId') || 0)
      const border = borders[borderId]
      if (border) styleBorders.set(index, border)
    })
  }
  const sheets: XlsxSheet[] = []
  for (const sheetNode of localElements(workbook, 'sheet')) {
    const name = sheetNode.getAttribute('name') || 'Sheet'
    const relation =
      relMap.get(sheetNode.getAttribute('id') || sheetNode.getAttribute('r:id') || '') || ''
    const target = relation.replace(/^\//, '').startsWith('xl/')
      ? relation.replace(/^\//, '')
      : `xl/${relation.replace(/^\.\//, '')}`
    if (!zip.file(target)) continue
    const sheetXml = await xml(target)
    const cells: XlsxCell[] = []
    for (const cellNode of localElements(sheetXml, 'c')) {
      const address = cellNode.getAttribute('r') || ''
      if (!address) continue
      const type = cellNode.getAttribute('t') || ''
      const formula = localElements(cellNode, 'f')[0]?.textContent || undefined
      const raw = localElements(cellNode, 'v')[0]?.textContent || ''
      const inline = textContent(localElements(cellNode, 'is')[0] || null)
      let value =
        type === 's' ? sharedStrings[Number(raw)] || '' : type === 'inlineStr' ? inline : raw
      if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      const styleId = Number(cellNode.getAttribute('s') || 0)
      cells.push({ address, value, formula, border: styleBorders.get(styleId) })
    }
    sheets.push({
      name,
      cells,
      maxRow: Math.max(1, ...cells.map((cell) => rowNumber(cell.address))),
      maxColumn: Math.max(1, ...cells.map((cell) => columnNumber(cell.address)))
    })
  }
  return sheets
}

const XlsxTable = ({ sheet }: { sheet: XlsxSheet }) => {
  const cells = useMemo(
    () => new Map(sheet.cells.map((cell) => [cell.address.toUpperCase(), cell])),
    [sheet.cells]
  )
  const columns = Math.min(sheet.maxColumn, 40)
  const rows = Math.min(sheet.maxRow, 500)
  return (
    <div className="min-w-full overflow-auto p-3" data-testid={workbenchSelectors.excelGrid}>
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 top-0 z-10 min-w-10 border border-[#D9D9D6] bg-[#F7F7F5] px-2 py-1" />
            {Array.from({ length: columns }, (_, index) => (
              <th
                key={index}
                className="border border-[#D9D9D6] bg-[#F7F7F5] px-3 py-1 font-medium text-[#787774]"
              >
                {index + 1}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, rowIndex) => (
            <tr key={rowIndex}>
              <th className="sticky left-0 z-10 border border-[#D9D9D6] bg-[#F7F7F5] px-2 py-1 font-medium text-[#787774]">
                {rowIndex + 1}
              </th>
              {Array.from({ length: columns }, (_, columnIndex) => {
                const address = `${columnLetters(columnIndex + 1)}${rowIndex + 1}`
                const cell = cells.get(address)
                const border =
                  cell?.border === 'green'
                    ? 'border-2 border-[#22A06B]'
                    : cell?.border === 'red'
                      ? 'border-2 border-[#D14343]'
                      : 'border border-[#E5E5E2]'
                return (
                  <td
                    key={columnIndex}
                    className={`${border} min-w-24 max-w-64 whitespace-pre-wrap break-words px-2 py-1 align-top text-[#37352F]`}
                    title={cell?.formula ? `=${cell.formula}` : undefined}
                  >
                    {cell ? cell.value : ''}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const CustomXlsxRenderer = ({ mainState }: DocRendererProps) => {
  const document = mainState.currentDocument as XlsxDocument | undefined
  const [sheets, setSheets] = useState<XlsxSheet[]>([])
  const [active, setActive] = useState(0)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    if (!document) return
    void readBytes(document)
      .then(parseWorkbook)
      .then((parsed) => {
        if (!cancelled) {
          setSheets(parsed)
          setActive(0)
          setError(null)
        }
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [document])
  if (!document) return null
  return (
    <div
      className="flex h-full w-full flex-col bg-white"
      data-testid={workbenchSelectors.excelViewer}
    >
      {error ? (
        <div className="m-auto text-sm text-[#787774]">Excel 预览失败：{error}</div>
      ) : (
        <>
          <div className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#E5E5E2] bg-[#F7F7F5] px-2 py-1">
            {sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                type="button"
                className={`border-b-2 px-3 py-1 text-xs ${index === active ? 'border-[#22A06B] font-medium text-[#37352F]' : 'border-transparent text-[#787774]'}`}
                onClick={() => setActive(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {sheets[active] ? (
              <XlsxTable sheet={sheets[active]} />
            ) : (
              <div className="p-4 text-sm text-[#787774]">工作簿为空</div>
            )}
          </div>
        </>
      )}
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
