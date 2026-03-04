import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type {
  DocxDetailedBlock,
  DocxDetailedParagraphBlock,
  DocxDetailedTableBlock,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOutlineBlock,
  DocxParagraphSpec,
  DocxTextRunSpec
} from '../../types'

type NodeMapById = Map<string, IndexedNode>

export type IndexedNode =
  | {
      kind: 'paragraph'
      blockId: string
      bodyIndex: number
      node: Element
    }
  | {
      kind: 'table'
      blockId: string
      bodyIndex: number
      node: Element
    }
  | {
      kind: 'table_cell'
      blockId: string
      tableBlockId: string
      bodyIndex: number
      row: number
      col: number
      node: Element
      firstParagraph: Element | null
    }

export type BlockIndex = {
  outline: DocxOutlineBlock[]
  nodesById: NodeMapById
  paragraphCount: number
  tableCount: number
  charCount: number
  bodyBlockCount: number
  cellBlockCount: number
}

export type ParsedDocxBundle = {
  zip: JSZip
  documentXml: string
  documentDom: Document
  meta: DocxOpenMeta
  imageCount: number
}

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DEFAULT_META: DocxOpenMeta = {
  title: '',
  creator: '',
  lastModifiedBy: '',
  description: '',
  defaultFont: ''
}

const isElementNode = (value: Node | null): value is Element => {
  return value !== null && value.nodeType === 1
}

const childElements = (node: Element, localName?: string): Element[] => {
  const out: Element[] = []
  const children = node.childNodes
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i)
    if (!isElementNode(child)) continue
    if (!localName || child.localName === localName) out.push(child)
  }
  return out
}

const firstChildElement = (node: Element, localName: string): Element | null => {
  const children = node.childNodes
  for (let i = 0; i < children.length; i += 1) {
    const child = children.item(i)
    if (!isElementNode(child)) continue
    if (child.localName === localName) return child
  }
  return null
}

const getAttr = (node: Element, localName: string): string => {
  const names = [localName, `w:${localName}`, `cp:${localName}`, `dc:${localName}`]
  for (const name of names) {
    const value = node.getAttribute(name)
    if (value) return value
  }
  return ''
}

const collectText = (node: Element): string => {
  let text = ''
  const stack: Node[] = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.nodeType === 3) {
      text += current.nodeValue || ''
      continue
    }
    if (!isElementNode(current)) continue
    const name = current.localName
    if (name === 'tab') {
      text += '\t'
      continue
    }
    if (name === 'br' || name === 'cr') {
      text += '\n'
      continue
    }
    const children = current.childNodes
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children.item(i)
      if (child) stack.push(child)
    }
  }
  return text
}

const paragraphStyle = (paragraph: Element): string => {
  const pPr = firstChildElement(paragraph, 'pPr')
  if (!pPr) return 'Normal'
  const pStyle = firstChildElement(pPr, 'pStyle')
  if (!pStyle) return 'Normal'
  const value = getAttr(pStyle, 'val')
  return value || 'Normal'
}

const paragraphTextRuns = (paragraph: Element): DocxTextRunSpec[] => {
  const runs: DocxTextRunSpec[] = []
  const runNodes = childElements(paragraph, 'r')
  for (const runNode of runNodes) {
    const text = collectText(runNode)
    if (!text) continue
    const rPr = firstChildElement(runNode, 'rPr')
    const colorNode = rPr ? firstChildElement(rPr, 'color') : null
    const color = colorNode ? getAttr(colorNode, 'val') : ''
    runs.push({
      text,
      bold: Boolean(rPr && firstChildElement(rPr, 'b')),
      italic: Boolean(rPr && firstChildElement(rPr, 'i')),
      underline: Boolean(rPr && firstChildElement(rPr, 'u')),
      color: color || undefined
    })
  }
  return runs
}

const paragraphDetail = (blockId: string, paragraph: Element): DocxDetailedParagraphBlock => {
  const runs = paragraphTextRuns(paragraph)
  const text = runs.length > 0 ? runs.map((run) => run.text).join('') : collectText(paragraph)
  return {
    blockId,
    type: 'paragraph',
    style: paragraphStyle(paragraph),
    text,
    runs
  }
}

const summarizeTable = (table: Element): { rows: number; cols: number; preview: string } => {
  const rows = childElements(table, 'tr')
  const rowCount = rows.length
  let colCount = 0
  const previewCells: string[] = []
  for (const row of rows) {
    const cells = childElements(row, 'tc')
    if (cells.length > colCount) colCount = cells.length
    for (const cell of cells) {
      previewCells.push(collectText(cell).trim())
      if (previewCells.length >= 4) break
    }
    if (previewCells.length >= 4) break
  }
  return {
    rows: rowCount,
    cols: colCount,
    preview: previewCells.filter(Boolean).join(' | ')
  }
}

const parseXml = (text: string): Document => {
  return new DOMParser().parseFromString(text, 'application/xml')
}

const readZipText = async (zip: JSZip, entry: string): Promise<string> => {
  const file = zip.file(entry)
  if (!file) return ''
  return await file.async('text')
}

const findFirstElementByLocalName = (doc: Document, localName: string): Element | null => {
  const stack: Node[] = [doc.documentElement]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !isElementNode(current)) continue
    if (current.localName === localName) return current
    const children = current.childNodes
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children.item(i)
      if (child) stack.push(child)
    }
  }
  return null
}

const parseMeta = async (zip: JSZip): Promise<DocxOpenMeta> => {
  const coreXml = await readZipText(zip, 'docProps/core.xml')
  const stylesXml = await readZipText(zip, 'word/styles.xml')

  const meta: DocxOpenMeta = { ...DEFAULT_META }

  if (coreXml) {
    const coreDoc = parseXml(coreXml)
    const title = findFirstElementByLocalName(coreDoc, 'title')
    const creator = findFirstElementByLocalName(coreDoc, 'creator')
    const modifiedBy = findFirstElementByLocalName(coreDoc, 'lastModifiedBy')
    const description = findFirstElementByLocalName(coreDoc, 'description')
    meta.title = title ? collectText(title).trim() : ''
    meta.creator = creator ? collectText(creator).trim() : ''
    meta.lastModifiedBy = modifiedBy ? collectText(modifiedBy).trim() : ''
    meta.description = description ? collectText(description).trim() : ''
  }

  if (stylesXml) {
    const stylesDoc = parseXml(stylesXml)
    const fonts = stylesDoc.getElementsByTagNameNS(WORD_NS, 'rFonts')
    if (fonts.length > 0) {
      const node = fonts.item(0)
      if (node) {
        const font = getAttr(node, 'ascii') || getAttr(node, 'eastAsia') || getAttr(node, 'cs')
        meta.defaultFont = font
      }
    }
  }

  return meta
}

const countImages = async (zip: JSZip): Promise<number> => {
  const relsXml = await readZipText(zip, 'word/_rels/document.xml.rels')
  if (!relsXml) return 0
  const relsDoc = parseXml(relsXml)
  const relationships = relsDoc.getElementsByTagName('Relationship')
  let count = 0
  for (let i = 0; i < relationships.length; i += 1) {
    const node = relationships.item(i)
    if (!node) continue
    const type = node.getAttribute('Type') || ''
    if (type.includes('/image')) count += 1
  }
  return count
}

const getBody = (doc: Document): Element => {
  const bodies = doc.getElementsByTagNameNS(WORD_NS, 'body')
  const body = bodies.item(0)
  if (!body) throw new Error('word/document.xml has no w:body')
  return body
}

const paragraphText = (paragraph: Element): string => {
  const runs = paragraphTextRuns(paragraph)
  if (runs.length > 0) return runs.map((item) => item.text).join('')
  return collectText(paragraph)
}

const cellParagraphs = (cell: Element): Element[] => {
  return childElements(cell, 'p')
}

const tableCells = (table: Element): Array<{ row: number; col: number; cell: Element }> => {
  const out: Array<{ row: number; col: number; cell: Element }> = []
  const rows = childElements(table, 'tr')
  for (let r = 0; r < rows.length; r += 1) {
    const cells = childElements(rows[r], 'tc')
    for (let c = 0; c < cells.length; c += 1) {
      out.push({
        row: r + 1,
        col: c + 1,
        cell: cells[c]
      })
    }
  }
  return out
}

export const buildBlockIndex = (documentDom: Document): BlockIndex => {
  const body = getBody(documentDom)
  const outline: DocxOutlineBlock[] = []
  const nodesById: NodeMapById = new Map()
  let bodyIndex = 0
  let paragraphCount = 0
  let tableCount = 0
  let charCount = 0
  let cellBlockCount = 0

  const bodyChildren = body.childNodes
  for (let i = 0; i < bodyChildren.length; i += 1) {
    const child = bodyChildren.item(i)
    if (!isElementNode(child)) continue
    if (child.localName === 'sectPr') continue

    if (child.localName === 'p') {
      const blockId = `b:${bodyIndex}`
      const text = paragraphText(child)
      const style = paragraphStyle(child)
      outline.push({
        blockId,
        type: 'paragraph',
        style,
        text
      })
      nodesById.set(blockId, {
        kind: 'paragraph',
        blockId,
        bodyIndex,
        node: child
      })
      paragraphCount += 1
      charCount += text.length
      bodyIndex += 1
      continue
    }

    if (child.localName === 'tbl') {
      const blockId = `tbl:${bodyIndex}`
      const tableSummary = summarizeTable(child)
      outline.push({
        blockId,
        type: 'table',
        rows: tableSummary.rows,
        cols: tableSummary.cols,
        preview: tableSummary.preview
      })
      nodesById.set(blockId, {
        kind: 'table',
        blockId,
        bodyIndex,
        node: child
      })
      tableCount += 1

      for (const entry of tableCells(child)) {
        const cellBlockId = `${blockId}.r:${entry.row}.c:${entry.col}`
        const paragraphs = cellParagraphs(entry.cell)
        const text = paragraphs.map((paragraph) => paragraphText(paragraph)).join('\n')
        outline.push({
          blockId: cellBlockId,
          type: 'table_cell',
          tableBlockId: blockId,
          row: entry.row,
          col: entry.col,
          text
        })
        nodesById.set(cellBlockId, {
          kind: 'table_cell',
          blockId: cellBlockId,
          tableBlockId: blockId,
          bodyIndex,
          row: entry.row,
          col: entry.col,
          node: entry.cell,
          firstParagraph: paragraphs[0] || null
        })
        cellBlockCount += 1
        paragraphCount += paragraphs.length
        charCount += text.length
      }
      bodyIndex += 1
    }
  }

  return {
    outline,
    nodesById,
    paragraphCount,
    tableCount,
    charCount,
    bodyBlockCount: bodyIndex,
    cellBlockCount
  }
}

export const toOpenStats = (index: BlockIndex, imageCount: number): DocxOpenStats => {
  return {
    blockCount: index.bodyBlockCount + index.cellBlockCount,
    paragraphCount: index.paragraphCount,
    tableCount: index.tableCount,
    imageCount,
    charCount: index.charCount
  }
}

export const buildOutlineOutput = (
  index: BlockIndex,
  input: {
    maxBlocks: number
    includeTables: boolean
    includeCells: boolean
  }
): {
  blocks: DocxOutlineBlock[]
  truncated: boolean
} => {
  const picked: DocxOutlineBlock[] = []
  for (const block of index.outline) {
    if (!input.includeTables && (block.type === 'table' || block.type === 'table_cell')) continue
    if (!input.includeCells && block.type === 'table_cell') continue
    picked.push(block)
    if (picked.length >= input.maxBlocks) break
  }
  return {
    blocks: picked,
    truncated: picked.length < index.outline.filter((block) => {
      if (!input.includeTables && (block.type === 'table' || block.type === 'table_cell')) return false
      if (!input.includeCells && block.type === 'table_cell') return false
      return true
    }).length
  }
}

const buildTableDetail = (blockId: string, tableNode: Element): DocxDetailedTableBlock => {
  const summary = summarizeTable(tableNode)
  const cells = tableCells(tableNode).map((entry) => {
    const paragraphs = cellParagraphs(entry.cell).map((paragraph, idx) =>
      paragraphDetail(`${blockId}.r:${entry.row}.c:${entry.col}.p:${idx + 1}`, paragraph)
    )
    return {
      blockId: `${blockId}.r:${entry.row}.c:${entry.col}`,
      row: entry.row,
      col: entry.col,
      paragraphs
    }
  })
  return {
    blockId,
    type: 'table',
    rows: summary.rows,
    cols: summary.cols,
    preview: summary.preview,
    cells
  }
}

export const getDetailedBlock = (index: BlockIndex, blockId: string): DocxDetailedBlock | null => {
  const node = index.nodesById.get(blockId)
  if (!node) return null
  if (node.kind === 'paragraph') return paragraphDetail(blockId, node.node)
  if (node.kind === 'table') return buildTableDetail(blockId, node.node)

  const paragraphs = cellParagraphs(node.node).map((paragraph, idx) =>
    paragraphDetail(`${blockId}.p:${idx + 1}`, paragraph)
  )
  return {
    blockId,
    type: 'table_cell',
    tableBlockId: node.tableBlockId,
    row: node.row,
    col: node.col,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    paragraphs
  }
}

export const extractBlockText = (index: BlockIndex, blockId: string): string => {
  const detail = getDetailedBlock(index, blockId)
  if (!detail) return ''
  if (detail.type === 'paragraph') return detail.text
  if (detail.type === 'table') return detail.cells.map((cell) => cell.paragraphs.map((p) => p.text).join('\n')).join('\n')
  return detail.text
}

const normalizeRuns = (runs: DocxTextRunSpec[]): DocxTextRunSpec[] => {
  return runs
    .map((run) => ({
      text: String(run.text || ''),
      bold: run.bold || undefined,
      italic: run.italic || undefined,
      underline: run.underline || undefined,
      color: run.color || undefined
    }))
    .filter((run) => run.text.length > 0)
}

export const paragraphNodeToSpec = (paragraph: Element): DocxParagraphSpec => {
  const runs = normalizeRuns(paragraphTextRuns(paragraph))
  return {
    kind: 'paragraph',
    style: paragraphStyle(paragraph),
    runs: runs.length > 0 ? runs : [{ text: paragraphText(paragraph) }]
  }
}

export const loadDocxBundle = async (buffer: Buffer): Promise<ParsedDocxBundle> => {
  const zip = await JSZip.loadAsync(buffer)
  const documentXml = await readZipText(zip, 'word/document.xml')
  if (!documentXml) {
    throw new Error('docx missing word/document.xml')
  }
  const documentDom = parseXml(documentXml)
  const meta = await parseMeta(zip)
  const imageCount = await countImages(zip)
  return {
    zip,
    documentXml,
    documentDom,
    meta,
    imageCount
  }
}
