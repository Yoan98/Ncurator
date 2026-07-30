import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type {
  DocxDetailedBlock,
  DocxBlockWrapper,
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
import type { BlockIndex, NodeMapById, ParsedDocxBundle } from './types'
import {
  buildParagraphDetail,
  buildTableDetail,
  readParagraphStyle,
  visualSummaryForBlock
} from './semanticTree'
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

const summarizeTable = (table: Element): { rows: number; cols: number; text: string } => {
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
    text: previewCells.filter(Boolean).join(' | ')
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

const attrByLocalName = (node: Element, names: readonly string[]): string => {
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attribute = node.attributes.item(index)
    if (attribute && names.includes(attribute.localName || attribute.name)) return attribute.value
  }
  return ''
}

const selectAlternateContent = (node: Element): Element[] => {
  const supported = new Set([
    'w',
    'w14',
    'w15',
    'wp',
    'wp14',
    'a',
    'pic',
    'c',
    'dgm',
    'wps',
    'wpg',
    'v',
    'o'
  ])
  const choice = childElements(node).find((child) => {
    if (child.localName !== 'Choice') return false
    const requirements = attrByLocalName(child, ['Requires']).split(/\s+/).filter(Boolean)
    return requirements.length > 0 && requirements.every((item) => supported.has(item))
  })
  const fallback = childElements(node).find((child) => child.localName === 'Fallback')
  return choice ? childElements(choice) : fallback ? childElements(fallback) : []
}

type LogicalBodyElement = {
  node: Element
  wrapperPath: DocxBlockWrapper[]
}

const collectLogicalBodyElements = (
  nodes: readonly Element[],
  wrapperPath: DocxBlockWrapper[] = [],
  path = 'body'
): LogicalBodyElement[] => {
  const output: LogicalBodyElement[] = []
  nodes.forEach((node, index) => {
    const nodePath = `${path}.${String(index)}`
    if (node.localName === 'p' || node.localName === 'tbl') {
      output.push({ node, wrapperPath })
      return
    }
    if (node.localName === 'sectPr' || node.localName === 'del' || node.localName === 'moveFrom')
      return
    if (node.localName === 'AlternateContent') {
      output.push(
        ...collectLogicalBodyElements(selectAlternateContent(node), wrapperPath, nodePath)
      )
      return
    }
    if (node.localName === 'sdt') {
      const properties = firstChildElement(node, 'sdtPr')
      const tagNode = properties ? firstChildElement(properties, 'tag') : null
      const content = firstChildElement(node, 'sdtContent')
      if (!content) return
      const wrapper: DocxBlockWrapper = {
        key: nodePath,
        type: 'content_control',
        tag: tagNode ? getAttr(tagNode, 'val') || undefined : undefined
      }
      output.push(
        ...collectLogicalBodyElements(childElements(content), [...wrapperPath, wrapper], nodePath)
      )
      return
    }
    if (node.localName === 'ins' || node.localName === 'moveTo') {
      const wrapper: DocxBlockWrapper = {
        key: nodePath,
        type: 'revision',
        kind: node.localName === 'moveTo' ? 'move_to' : 'insert'
      }
      output.push(
        ...collectLogicalBodyElements(childElements(node), [...wrapperPath, wrapper], nodePath)
      )
      return
    }
    if (!['drawing', 'pict', 'object', 'txbxContent'].includes(node.localName)) {
      output.push(...collectLogicalBodyElements(childElements(node), wrapperPath, nodePath))
    }
  })
  return output
}

const resolveBodyNeighbors = (
  bodyBlockIds: readonly string[],
  blockIndex: number
): { previousBlockId?: string; nextBlockId?: string } => ({
  previousBlockId: blockIndex > 0 ? bodyBlockIds[blockIndex - 1] : undefined,
  nextBlockId: blockIndex + 1 < bodyBlockIds.length ? bodyBlockIds[blockIndex + 1] : undefined
})

const withParagraphStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineParagraphBlock, 'previousBlockId' | 'nextBlockId'>
): DocxOutlineParagraphBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.blockIndex)
})

const withTableStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineTableBlock, 'previousBlockId' | 'nextBlockId'>
): DocxOutlineTableBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.blockIndex)
})

const withCellStructure = (
  bodyBlockIds: readonly string[],
  block: Omit<DocxOutlineCellBlock, 'previousBlockId' | 'nextBlockId'>
): DocxOutlineCellBlock => ({
  ...block,
  ...resolveBodyNeighbors(bodyBlockIds, block.blockIndex)
})

export const buildBlockIndex = (
  documentDom: Document,
  relationshipTargets: ReadonlyMap<string, string> = new Map(),
  relationshipTypes: ReadonlyMap<string, string> = new Map()
): BlockIndex => {
  const body = getBody(documentDom)
  const outlineDraft: DocxOutlineBlock[] = []
  const nodesById: NodeMapById = new Map()
  const bodyBlockIds: string[] = []
  let blockIndex = 0
  let paragraphCount = 0
  let tableCount = 0
  let charCount = 0
  let cellBlockCount = 0
  const detailByBlockId: BlockIndex['detailByBlockId'] = new Map()
  const editableNodesById: BlockIndex['editableNodesById'] = new Map()
  const visualsById: BlockIndex['visualsById'] = new Map()

  const bodyChildren = collectLogicalBodyElements(childElements(body))
  for (const logical of bodyChildren) {
    const child = logical.node
    const wrapperPath = logical.wrapperPath

    if (child.localName === 'p') {
      const blockId = `b:${blockIndex}`
      const text = paragraphText(child)
      const style = readParagraphStyle(child)
      const layoutMode = paragraphLayoutMode(child)
      bodyBlockIds.push(blockId)
      outlineDraft.push({
        blockId,
        type: 'paragraph',
        blockIndex,
        layoutMode,
        style,
        text
      })
      nodesById.set(blockId, {
        kind: 'paragraph',
        blockId,
        blockIndex,
        layoutMode,
        wrapperPath,
        node: child
      })
      paragraphCount += 1
      charCount += text.length
      blockIndex += 1
      continue
    }

    if (child.localName === 'tbl') {
      const blockId = `tbl:${blockIndex}`
      const tableSummary = summarizeTable(child)
      const layoutMode = tableLayoutMode(child)
      bodyBlockIds.push(blockId)
      outlineDraft.push({
        blockId,
        type: 'table',
        blockIndex,
        layoutMode,
        rows: tableSummary.rows,
        cols: tableSummary.cols,
        text: tableSummary.text
      })
      nodesById.set(blockId, {
        kind: 'table',
        blockId,
        blockIndex,
        layoutMode,
        wrapperPath,
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
          blockIndex,
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
          blockIndex,
          layoutMode,
          wrapperPath,
          row: entry.row,
          col: entry.col,
          node: entry.cell,
          firstParagraph: paragraphs[0] || null
        })
        cellBlockCount += 1
        paragraphCount += paragraphs.length
        charCount += text.length
      }
      blockIndex += 1
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

  for (const blockId of bodyBlockIds) {
    const node = nodesById.get(blockId)
    if (!node || node.kind === 'table_cell') continue
    const neighbors = resolveBodyNeighbors(bodyBlockIds, node.blockIndex)
    const shared = {
      blockId,
      blockIndex: node.blockIndex,
      layoutMode: node.layoutMode,
      wrapperPath: node.wrapperPath,
      ...neighbors,
      relationshipTargets,
      relationshipTypes,
      editableNodesById,
      visualsById
    }
    const detail =
      node.kind === 'paragraph'
        ? buildParagraphDetail({ ...shared, paragraph: node.node })
        : buildTableDetail({ ...shared, table: node.node })
    detailByBlockId.set(blockId, detail)
  }

  for (const [blockId, node] of nodesById) {
    if (node.kind !== 'table_cell') continue
    const table = detailByBlockId.get(node.tableBlockId)
    if (!table || table.type !== 'table') continue
    const parsed = table.children[node.row - 1]?.children[node.col - 1]
    if (!parsed) continue
    const neighbors = resolveBodyNeighbors(bodyBlockIds, node.blockIndex)
    detailByBlockId.set(blockId, {
      blockId,
      tableBlockId: node.tableBlockId,
      blockIndex: node.blockIndex,
      layoutMode: node.layoutMode,
      wrapperPath: node.wrapperPath,
      ...neighbors,
      type: 'table_cell',
      row: node.row,
      col: node.col,
      style: parsed.style,
      text: parsed.text,
      children: parsed.children
    })
  }

  outline.forEach((block) => {
    const detail = detailByBlockId.get(block.blockId)
    if (detail) block.text = detail.text
    const visuals = detail ? visualSummaryForBlock(detail) : undefined
    if (visuals) block.visuals = visuals
  })
  charCount = outline.reduce(
    (total, block) => total + (block.type === 'table' ? 0 : block.text.length),
    0
  )

  return {
    outline,
    nodesById,
    bodyBlockIds,
    paragraphCount,
    tableCount,
    charCount,
    bodyBlockCount: blockIndex,
    cellBlockCount,
    detailByBlockId,
    editableNodesById,
    visualsById
  }
}

export const toOpenStats = (index: BlockIndex): DocxOpenStats => {
  const visualKinds = [...new Set([...index.visualsById.values()].map((visual) => visual.kind))]
  const imageCount = [...index.visualsById.values()].filter(
    (visual) => visual.kind === 'image'
  ).length
  return {
    blockCount: index.bodyBlockCount + index.cellBlockCount,
    bodyBlockCount: index.bodyBlockCount,
    paragraphCount: index.paragraphCount,
    tableCount: index.tableCount,
    imageCount,
    visualCount: index.visualsById.size,
    visualKinds,
    charCount: index.charCount
  }
}

export const buildOutlineOutput = (
  index: BlockIndex,
  input: {
    ranges: Array<{
      fromBlockIndex: number
      toBlockIndex: number
    }>
    includeTables: boolean
    includeCells: boolean
  }
): {
  blocks: DocxOutlineBlock[]
} => {
  const normalizedRanges = input.ranges
    .map((range) => ({
      fromBlockIndex: Math.max(0, Math.min(range.fromBlockIndex, range.toBlockIndex)),
      toBlockIndex: Math.max(0, Math.max(range.fromBlockIndex, range.toBlockIndex))
    }))
    .filter((range) => range.toBlockIndex >= range.fromBlockIndex)

  const visibleBlocks = index.outline.filter((block) => {
    if (!input.includeTables && (block.type === 'table' || block.type === 'table_cell'))
      return false
    if (!input.includeCells && block.type === 'table_cell') return false
    return normalizedRanges.some(
      (range) => block.blockIndex >= range.fromBlockIndex && block.blockIndex <= range.toBlockIndex
    )
  })
  return {
    blocks: visibleBlocks
  }
}

export const getDetailedBlock = (index: BlockIndex, blockId: string): DocxDetailedBlock | null => {
  return index.detailByBlockId.get(blockId) || null
}

export const getBlockStructureFacts = (
  index: BlockIndex,
  blockId: string
): {
  blockType: 'paragraph' | 'table' | 'table_cell'
  blockIndex: number
  previousBlockId?: string
  nextBlockId?: string
  tableBlockId?: string
} | null => {
  const node = index.nodesById.get(blockId)
  if (!node) return null
  return {
    blockType: node.kind,
    blockIndex: node.blockIndex,
    ...resolveBodyNeighbors(index.bodyBlockIds, node.blockIndex),
    tableBlockId: node.kind === 'table_cell' ? node.tableBlockId : undefined
  }
}

export const extractBlockText = (index: BlockIndex, blockId: string): string => {
  const detail = getDetailedBlock(index, blockId)
  if (!detail) return ''
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
  const relationshipsXml = await readZipText(zip, 'word/_rels/document.xml.rels')
  const relationshipTargets = new Map<string, string>()
  const relationshipTypes = new Map<string, string>()
  if (relationshipsXml) {
    const relationshipsDoc = parseXml(relationshipsXml)
    const relationships = relationshipsDoc.getElementsByTagName('Relationship')
    for (let index = 0; index < relationships.length; index += 1) {
      const relationship = relationships.item(index)
      if (!relationship) continue
      const id = relationship.getAttribute('Id') || ''
      if (!id) continue
      relationshipTargets.set(id, relationship.getAttribute('Target') || '')
      relationshipTypes.set(id, relationship.getAttribute('Type') || '')
    }
  }
  return {
    zip,
    documentXml,
    documentDom,
    meta,
    relationshipTargets,
    relationshipTypes
  }
}
