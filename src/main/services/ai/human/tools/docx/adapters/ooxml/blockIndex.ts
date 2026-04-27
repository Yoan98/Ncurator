import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type {
  DocxDetailedBlock,
  DocxDetailedParagraphBlock,
  DocxDetailedTableBlock,
  DocxLayoutMode,
  DocxOutlineCellBlock,
  DocxOutlineParagraphBlock,
  DocxOutlineTableBlock,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOutlineBlock,
  DocxParagraphSpec,
  DocxTextRunSpec
} from '../../types'
import type {
  BlockIndex,
  NodeMapById,
  ParsedDocxBundle
} from './types'
import {
  childElements,
  collectText,
  descendantElements,
  findFirstElementByLocalName,
  firstChildElement,
  getAttr,
  isElementNode
} from './dom'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const DEFAULT_META: DocxOpenMeta = {
  title: '',
  creator: '',
  lastModifiedBy: '',
  description: '',
  defaultFont: ''
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
  const runNodes = descendantElements(paragraph, 'r')
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
    bodyIndex: -1,
    layoutMode: 'normal',
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

const hasDescendantLocalName = (node: Element, localName: string): boolean =>
  descendantElements(node, localName).length > 0

const hasAncestorLocalName = (node: Element, localNames: readonly string[]): boolean => {
  let current: Node | null = node.parentNode
  while (current) {
    if (isElementNode(current) && current.localName && localNames.includes(current.localName)) {
      return true
    }
    current = current.parentNode
  }
  return false
}

const paragraphLayoutMode = (paragraph: Element): DocxLayoutMode => {
  const pPr = firstChildElement(paragraph, 'pPr')
  if (pPr && firstChildElement(pPr, 'framePr')) {
    return 'positioned'
  }
  if (
    hasAncestorLocalName(paragraph, ['txbxContent', 'textbox', 'shape']) ||
    hasDescendantLocalName(paragraph, 'anchor')
  ) {
    return 'positioned'
  }
  return 'normal'
}

const tableLayoutMode = (table: Element): DocxLayoutMode => {
  if (
    hasAncestorLocalName(table, ['txbxContent', 'textbox', 'shape']) ||
    hasDescendantLocalName(table, 'anchor')
  ) {
    return 'positioned'
  }
  return 'normal'
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

const resolveBodyNeighbors = (
  bodyBlockIds: readonly string[],
  bodyIndex: number
): { previousBodyBlockId?: string; nextBodyBlockId?: string } => ({
  previousBodyBlockId: bodyIndex > 0 ? bodyBlockIds[bodyIndex - 1] : undefined,
  nextBodyBlockId: bodyIndex + 1 < bodyBlockIds.length ? bodyBlockIds[bodyIndex + 1] : undefined
})

const withParagraphStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineParagraphBlock, 'previousBodyBlockId' | 'nextBodyBlockId'>
): DocxOutlineParagraphBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.bodyIndex)
})

const withTableStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineTableBlock, 'previousBodyBlockId' | 'nextBodyBlockId'>
): DocxOutlineTableBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.bodyIndex)
})

const withCellStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineCellBlock, 'previousBodyBlockId' | 'nextBodyBlockId'>
): DocxOutlineCellBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.bodyIndex)
})

export const buildBlockIndex = (documentDom: Document): BlockIndex => {
  const body = getBody(documentDom)
  const outlineDraft: DocxOutlineBlock[] = []
  const nodesById: NodeMapById = new Map()
  const bodyBlockIds: string[] = []
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
      const layoutMode = paragraphLayoutMode(child)
      bodyBlockIds.push(blockId)
      outlineDraft.push({
        blockId,
        type: 'paragraph',
        bodyIndex,
        layoutMode,
        style,
        text
      })
      nodesById.set(blockId, {
        kind: 'paragraph',
        blockId,
        bodyIndex,
        layoutMode,
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
      const layoutMode = tableLayoutMode(child)
      bodyBlockIds.push(blockId)
      outlineDraft.push({
        blockId,
        type: 'table',
        bodyIndex,
        layoutMode,
        rows: tableSummary.rows,
        cols: tableSummary.cols,
        preview: tableSummary.preview
      })
      nodesById.set(blockId, {
        kind: 'table',
        blockId,
        bodyIndex,
        layoutMode,
        node: child
      })
      tableCount += 1

      for (const entry of tableCells(child)) {
        const cellBlockId = `${blockId}.r:${entry.row}.c:${entry.col}`
        const paragraphs = cellParagraphs(entry.cell)
        const text = paragraphs.map((paragraph) => paragraphText(paragraph)).join('\n')
        outlineDraft.push({
          blockId: cellBlockId,
          type: 'table_cell',
          bodyIndex,
          layoutMode,
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
          layoutMode,
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

  const outline = outlineDraft.map((block) => {
    if (block.type === 'paragraph') {
      return withParagraphStructure(bodyBlockIds, block)
    }
    if (block.type === 'table') {
      return withTableStructure(bodyBlockIds, block)
    }
    return withCellStructure(bodyBlockIds, block)
  })

  return {
    outline,
    nodesById,
    bodyBlockIds,
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
    fromBodyIndex?: number
    maxBlocks: number
    includeTables: boolean
    includeCells: boolean
  }
): {
  blocks: DocxOutlineBlock[]
  truncated: boolean
} => {
  const fromBodyIndex = Math.max(0, Number(input.fromBodyIndex || 0))
  const visibleBlocks = index.outline.filter((block) => {
    if (block.bodyIndex < fromBodyIndex) return false
    if (!input.includeTables && (block.type === 'table' || block.type === 'table_cell')) return false
    if (!input.includeCells && block.type === 'table_cell') return false
    return true
  })
  const picked: DocxOutlineBlock[] = []
  for (const block of visibleBlocks) {
    picked.push(block)
    if (picked.length >= input.maxBlocks) break
  }
  return {
    blocks: picked,
    truncated: picked.length < visibleBlocks.length
  }
}

const buildTableDetail = (
  index: BlockIndex,
  blockId: string,
  tableNode: Element,
  bodyIndex: number
): DocxDetailedTableBlock => {
  const tableIndexedNode = index.nodesById.get(blockId)
  const tableLayoutMode = tableIndexedNode?.kind === 'table' ? tableIndexedNode.layoutMode : 'normal'
  const summary = summarizeTable(tableNode)
  const cells = tableCells(tableNode).map((entry) => {
    const paragraphs = cellParagraphs(entry.cell).map((paragraph, idx) =>
      {
        const detail = paragraphDetail(
          `${blockId}.r:${entry.row}.c:${entry.col}.p:${idx + 1}`,
          paragraph
        )
        return {
          ...detail,
          bodyIndex,
          layoutMode: tableLayoutMode
        }
      }
    )
    return {
      blockId: `${blockId}.r:${entry.row}.c:${entry.col}`,
      layoutMode: tableLayoutMode,
      row: entry.row,
      col: entry.col,
      paragraphs
    }
  })
  return {
    blockId,
    type: 'table',
    bodyIndex,
    layoutMode: tableLayoutMode,
    ...resolveBodyNeighbors(index.bodyBlockIds, bodyIndex),
    rows: summary.rows,
    cols: summary.cols,
    preview: summary.preview,
    cells
  }
}

export const getDetailedBlock = (index: BlockIndex, blockId: string): DocxDetailedBlock | null => {
  const node = index.nodesById.get(blockId)
  if (!node) return null
  if (node.kind === 'paragraph') {
    return {
      ...paragraphDetail(blockId, node.node),
      bodyIndex: node.bodyIndex,
      layoutMode: node.layoutMode,
      ...resolveBodyNeighbors(index.bodyBlockIds, node.bodyIndex)
    }
  }
  if (node.kind === 'table') return buildTableDetail(index, blockId, node.node, node.bodyIndex)

  const paragraphs = cellParagraphs(node.node).map((paragraph, idx) =>
    {
      const detail = paragraphDetail(`${blockId}.p:${idx + 1}`, paragraph)
      return {
        ...detail,
        bodyIndex: node.bodyIndex,
        layoutMode: node.layoutMode
      }
    }
  )
  return {
    blockId,
    type: 'table_cell',
    bodyIndex: node.bodyIndex,
    layoutMode: node.layoutMode,
    ...resolveBodyNeighbors(index.bodyBlockIds, node.bodyIndex),
    tableBlockId: node.tableBlockId,
    row: node.row,
    col: node.col,
    text: paragraphs.map((paragraph) => paragraph.text).join('\n'),
    paragraphs
  }
}

export const getBlockStructureFacts = (
  index: BlockIndex,
  blockId: string
):
  | {
      blockType: 'paragraph' | 'table' | 'table_cell'
      bodyIndex: number
      previousBodyBlockId?: string
      nextBodyBlockId?: string
      tableBlockId?: string
    }
  | null => {
  const node = index.nodesById.get(blockId)
  if (!node) return null
  return {
    blockType: node.kind,
    bodyIndex: node.bodyIndex,
    ...resolveBodyNeighbors(index.bodyBlockIds, node.bodyIndex),
    tableBlockId: node.kind === 'table_cell' ? node.tableBlockId : undefined
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
