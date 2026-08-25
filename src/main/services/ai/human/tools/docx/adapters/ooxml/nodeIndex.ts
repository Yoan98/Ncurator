import JSZip from 'jszip'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import type {
  DocxDetailedNode,
  DocxLayoutMode,
  DocxOutlineCellNode,
  DocxOutlineContainerNode,
  DocxOutlineParagraphNode,
  DocxOutlineTableNode,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOutlineNode,
  DocxParagraphSpec,
  DocxTextRunSpec
} from '../../types'
import type { NodeIndex, DocxStoryPart, NodeMapById, ParsedDocxBundle } from './types'
import {
  buildParagraphDetail,
  buildContainerDetail,
  buildTableDetail,
  readParagraphStyle,
  visualSummaryForNode
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
import { resolveDocxRelationshipTarget } from './relationshipPath'

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

const relationshipPartName = (partName: string): string => {
  const directory = path.posix.dirname(partName)
  const fileName = path.posix.basename(partName)
  return path.posix.join(directory, '_rels', `${fileName}.rels`)
}

const parsePartRelationships = async (
  zip: JSZip,
  partName: string
): Promise<{
  targets: Map<string, string>
  types: Map<string, string>
  targetModes: Map<string, string>
  availableTargetIds: Set<string>
}> => {
  const targets = new Map<string, string>()
  const types = new Map<string, string>()
  const targetModes = new Map<string, string>()
  const availableTargetIds = new Set<string>()
  const xml = await readZipText(zip, relationshipPartName(partName))
  if (!xml) return { targets, types, targetModes, availableTargetIds }
  const dom = parseXml(xml)
  const relationships = dom.getElementsByTagName('Relationship')
  for (let index = 0; index < relationships.length; index += 1) {
    const relationship = relationships.item(index)
    if (!relationship) continue
    const id = relationship.getAttribute('Id') || ''
    if (!id) continue
    const target = relationship.getAttribute('Target') || ''
    const mode = relationship.getAttribute('TargetMode') || ''
    targets.set(id, target)
    types.set(id, relationship.getAttribute('Type') || '')
    targetModes.set(id, mode)
    const resolved = resolveDocxRelationshipTarget(target, partName)
    if (mode.toLowerCase() !== 'external' && resolved && zip.file(resolved)) {
      availableTargetIds.add(id)
    }
  }
  return { targets, types, targetModes, availableTargetIds }
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
}

const collectLogicalBodyElements = (nodes: readonly Element[]): LogicalBodyElement[] => {
  const output: LogicalBodyElement[] = []
  nodes.forEach((node) => {
    if (
      node.localName === 'p' ||
      node.localName === 'tbl' ||
      node.localName === 'sdt' ||
      ['ins', 'del', 'moveFrom', 'moveTo'].includes(node.localName)
    ) {
      output.push({ node })
      return
    }
    if (node.localName === 'sectPr') return
    if (node.localName === 'AlternateContent') {
      output.push(...collectLogicalBodyElements(selectAlternateContent(node)))
      return
    }
    if (!['drawing', 'pict', 'object', 'txbxContent'].includes(node.localName)) {
      output.push(...collectLogicalBodyElements(childElements(node)))
    }
  })
  return output
}

const resolveBodyNeighbors = (
  rootNodeIds: readonly string[],
  nodeId: string
): { previousNodeId?: string; nextNodeId?: string } => {
  const position = rootNodeIds.indexOf(nodeId)
  return {
    previousNodeId: position > 0 ? rootNodeIds[position - 1] : undefined,
    nextNodeId:
      position >= 0 && position + 1 < rootNodeIds.length ? rootNodeIds[position + 1] : undefined
  }
}

const withParagraphStructure = (
  rootNodeIds: readonly string[],
  node: Omit<DocxOutlineParagraphNode, 'previousNodeId' | 'nextNodeId'>
): DocxOutlineParagraphNode => ({
  ...node,
  ...resolveBodyNeighbors(rootNodeIds, node.nodeId)
})

const withTableStructure = (
  rootNodeIds: readonly string[],
  node: Omit<DocxOutlineTableNode, 'previousNodeId' | 'nextNodeId'>
): DocxOutlineTableNode => ({
  ...node,
  ...resolveBodyNeighbors(rootNodeIds, node.nodeId)
})

const withCellStructure = (
  rootNodeIds: readonly string[],
  node: Omit<DocxOutlineCellNode, 'previousNodeId' | 'nextNodeId'>
): DocxOutlineCellNode => ({
  ...node,
  ...resolveBodyNeighbors(rootNodeIds, node.nodeId)
})

const withContainerStructure = (
  rootNodeIds: readonly string[],
  node: DocxOutlineContainerNode
): DocxOutlineContainerNode => ({
  ...node,
  ...resolveBodyNeighbors(rootNodeIds, node.nodeId)
})

export const buildNodeIndex = (
  documentDom: Document,
  relationshipTargets: ReadonlyMap<string, string> = new Map(),
  relationshipTypes: ReadonlyMap<string, string> = new Map(),
  relationshipTargetModes: ReadonlyMap<string, string> = new Map(),
  availableRelationshipTargetIds?: ReadonlySet<string>,
  options?: {
    storyPart?: DocxStoryPart
    nodeIndexOffset?: number
  }
): NodeIndex => {
  const storyPart = options?.storyPart
  const body = storyPart?.root || getBody(documentDom)
  const story = storyPart?.story || { storyId: 'body', type: 'body' as const }
  const partName = storyPart?.partName || 'word/document.xml'
  const idPrefix = `${story.storyId}:`
  const outlineDraft: DocxOutlineNode[] = []
  const nodesById: NodeMapById = new Map()
  const rootNodeIds: string[] = []
  let nodeIndex = options?.nodeIndexOffset || 0
  let storyRootCount = 0
  let paragraphCount = 0
  let tableCount = 0
  let charCount = 0
  let cellNodeCount = 0
  const detailByNodeId: NodeIndex['detailByNodeId'] = new Map()
  const editableNodesById: NodeIndex['editableNodesById'] = new Map()
  const visualsById: NodeIndex['visualsById'] = new Map()

  const bodyChildren = collectLogicalBodyElements(childElements(body))
  for (const logical of bodyChildren) {
    const child = logical.node

    if (
      child.localName === 'sdt' ||
      ['ins', 'del', 'moveFrom', 'moveTo'].includes(child.localName)
    ) {
      const properties = child.localName === 'sdt' ? firstChildElement(child, 'sdtPr') : null
      const tagNode = properties ? firstChildElement(properties, 'tag') : null
      const isContentControl = child.localName === 'sdt'
      const kind = isContentControl ? ('content_control' as const) : ('revision' as const)
      const revisionKind =
        child.localName === 'del'
          ? ('delete' as const)
          : child.localName === 'moveFrom'
            ? ('move_from' as const)
            : child.localName === 'moveTo'
              ? ('move_to' as const)
              : ('insert' as const)
      const nodeId = `${idPrefix}${kind}:${storyRootCount}`
      const layoutMode: DocxLayoutMode = 'normal'
      rootNodeIds.push(nodeId)
      if (isContentControl) {
        outlineDraft.push({
          nodeId,
          type: 'content_control',
          nodeIndex,
          layoutMode,
          text: '',
          story,
          tag: tagNode ? getAttr(tagNode, 'val') || undefined : undefined
        })
      } else {
        outlineDraft.push({
          nodeId,
          type: 'revision',
          nodeIndex,
          layoutMode,
          text: '',
          story,
          revisionId: getAttr(child, 'id'),
          revisionKind
        })
      }
      nodesById.set(nodeId, {
        kind,
        nodeId,
        nodeIndex,
        layoutMode,
        story,
        partName,
        node: child
      })
      nodeIndex += 1
      storyRootCount += 1
      continue
    }

    if (child.localName === 'p') {
      const nodeId = `${idPrefix}p:${storyRootCount}`
      const text = paragraphText(child)
      const style = readParagraphStyle(child)
      const layoutMode = paragraphLayoutMode(child)
      rootNodeIds.push(nodeId)
      outlineDraft.push({
        nodeId,
        type: 'paragraph',
        nodeIndex,
        layoutMode,
        style,
        text,
        story
      })
      nodesById.set(nodeId, {
        kind: 'paragraph',
        nodeId,
        nodeIndex,
        layoutMode,
        story,
        partName,
        node: child
      })
      paragraphCount += 1
      charCount += text.length
      nodeIndex += 1
      storyRootCount += 1
      continue
    }

    if (child.localName === 'tbl') {
      const nodeId = `${idPrefix}tbl:${storyRootCount}`
      const tableSummary = summarizeTable(child)
      const layoutMode = tableLayoutMode(child)
      rootNodeIds.push(nodeId)
      outlineDraft.push({
        nodeId,
        type: 'table',
        nodeIndex,
        layoutMode,
        rows: tableSummary.rows,
        cols: tableSummary.cols,
        text: tableSummary.text,
        story
      })
      nodesById.set(nodeId, {
        kind: 'table',
        nodeId,
        nodeIndex,
        layoutMode,
        story,
        partName,
        node: child
      })
      tableCount += 1

      for (const entry of tableCells(child)) {
        const cellNodeId = `${nodeId}.r:${entry.row}.c:${entry.col}`
        const paragraphs = cellParagraphs(entry.cell)
        const text = paragraphs.map((paragraph) => paragraphText(paragraph)).join('\n')
        outlineDraft.push({
          nodeId: cellNodeId,
          type: 'table_cell',
          nodeIndex,
          layoutMode,
          tableNodeId: nodeId,
          row: entry.row,
          col: entry.col,
          text,
          story
        })
        nodesById.set(cellNodeId, {
          kind: 'table_cell',
          nodeId: cellNodeId,
          tableNodeId: nodeId,
          nodeIndex,
          layoutMode,
          story,
          partName,
          row: entry.row,
          col: entry.col,
          node: entry.cell,
          firstParagraph: paragraphs[0] || null
        })
        cellNodeCount += 1
        paragraphCount += paragraphs.length
        charCount += text.length
      }
      nodeIndex += 1
      storyRootCount += 1
    }
  }

  const outline = outlineDraft.map((node) => {
    if (node.type === 'paragraph') {
      return withParagraphStructure(rootNodeIds, node)
    }
    if (node.type === 'table') {
      return withTableStructure(rootNodeIds, node)
    }
    if (node.type === 'table_cell') return withCellStructure(rootNodeIds, node)
    return withContainerStructure(rootNodeIds, node)
  })

  for (const nodeId of rootNodeIds) {
    const node = nodesById.get(nodeId)
    if (!node || node.kind === 'table_cell') continue
    const neighbors = resolveBodyNeighbors(rootNodeIds, nodeId)
    const shared = {
      nodeId,
      nodeIndex: node.nodeIndex,
      layoutMode: node.layoutMode,
      story: node.story,
      partName: node.partName,
      ...neighbors,
      relationshipTargets,
      relationshipTypes,
      relationshipTargetModes,
      availableRelationshipTargetIds,
      editableNodesById,
      visualsById
    }
    const detail =
      node.kind === 'paragraph'
        ? buildParagraphDetail({ ...shared, paragraph: node.node })
        : node.kind === 'table'
          ? buildTableDetail({ ...shared, table: node.node })
          : buildContainerDetail({ ...shared, container: node.node })
    detailByNodeId.set(nodeId, detail)
  }

  for (const [nodeId, node] of nodesById) {
    if (node.kind !== 'table_cell') continue
    const table = detailByNodeId.get(node.tableNodeId)
    if (!table || table.type !== 'table') continue
    const parsed = table.children[node.row - 1]?.children[node.col - 1]
    if (!parsed) continue
    const neighbors = resolveBodyNeighbors(rootNodeIds, nodeId)
    detailByNodeId.set(nodeId, {
      nodeId,
      tableNodeId: node.tableNodeId,
      nodeIndex: node.nodeIndex,
      layoutMode: node.layoutMode,
      story: node.story,
      ...neighbors,
      type: 'table_cell',
      row: node.row,
      col: node.col,
      style: parsed.style,
      text: parsed.text,
      children: parsed.children
    })
  }

  outline.forEach((node) => {
    const detail = detailByNodeId.get(node.nodeId)
    if (detail) node.text = detail.text
    const visuals = detail ? visualSummaryForNode(detail) : undefined
    if (visuals) node.visuals = visuals
  })
  charCount = outline.reduce(
    (total, node) => total + (node.type === 'table' ? 0 : node.text.length),
    0
  )

  return {
    outline,
    nodesById,
    rootNodeIds,
    paragraphCount,
    tableCount,
    charCount,
    rootNodeCount: storyRootCount,
    cellNodeCount,
    detailByNodeId,
    editableNodesById,
    visualsById
  }
}

export const buildDocumentNodeIndex = (bundle: ParsedDocxBundle): NodeIndex => {
  const parts =
    bundle.stories.length > 0
      ? bundle.stories
      : [
          {
            story: { storyId: 'body', type: 'body' as const },
            partName: 'word/document.xml',
            dom: bundle.documentDom,
            root: getBody(bundle.documentDom),
            relationshipTargets: bundle.relationshipTargets,
            relationshipTypes: bundle.relationshipTypes,
            relationshipTargetModes: bundle.relationshipTargetModes,
            availableRelationshipTargetIds: bundle.availableRelationshipTargetIds
          }
        ]
  const combined: NodeIndex = {
    outline: [],
    nodesById: new Map(),
    rootNodeIds: [],
    paragraphCount: 0,
    tableCount: 0,
    charCount: 0,
    rootNodeCount: 0,
    cellNodeCount: 0,
    detailByNodeId: new Map(),
    editableNodesById: new Map(),
    visualsById: new Map()
  }
  for (const storyPart of parts) {
    const part = buildNodeIndex(
      storyPart.dom,
      storyPart.relationshipTargets,
      storyPart.relationshipTypes,
      storyPart.relationshipTargetModes,
      storyPart.availableRelationshipTargetIds,
      { storyPart, nodeIndexOffset: combined.rootNodeCount }
    )
    combined.outline.push(...part.outline)
    combined.rootNodeIds.push(...part.rootNodeIds)
    part.nodesById.forEach((value, key) => combined.nodesById.set(key, value))
    part.detailByNodeId.forEach((value, key) => combined.detailByNodeId.set(key, value))
    part.editableNodesById.forEach((value, key) => combined.editableNodesById.set(key, value))
    part.visualsById.forEach((value, key) => combined.visualsById.set(key, value))
    combined.paragraphCount += part.paragraphCount
    combined.tableCount += part.tableCount
    combined.charCount += part.charCount
    combined.rootNodeCount += part.rootNodeCount
    combined.cellNodeCount += part.cellNodeCount
  }
  return combined
}

export const toOpenStats = (index: NodeIndex): DocxOpenStats => {
  const visualKinds = [...new Set([...index.visualsById.values()].map((visual) => visual.kind))]
  const imageCount = [...index.visualsById.values()].filter(
    (visual) => visual.kind === 'image'
  ).length
  return {
    nodeCount: index.rootNodeCount + index.cellNodeCount,
    rootNodeCount: index.rootNodeCount,
    paragraphCount: index.paragraphCount,
    tableCount: index.tableCount,
    imageCount,
    visualCount: index.visualsById.size,
    visualKinds,
    charCount: index.charCount
  }
}

export const buildOutlineOutput = (
  index: NodeIndex,
  input: {
    ranges: Array<{
      fromNodeIndex: number
      toNodeIndex: number
    }>
    includeTables: boolean
    includeCells: boolean
  }
): {
  nodes: DocxOutlineNode[]
} => {
  const normalizedRanges = input.ranges
    .map((range) => ({
      fromNodeIndex: Math.max(0, Math.min(range.fromNodeIndex, range.toNodeIndex)),
      toNodeIndex: Math.max(0, Math.max(range.fromNodeIndex, range.toNodeIndex))
    }))
    .filter((range) => range.toNodeIndex >= range.fromNodeIndex)

  const visibleNodes = index.outline.filter((node) => {
    if (!input.includeTables && (node.type === 'table' || node.type === 'table_cell')) return false
    if (!input.includeCells && node.type === 'table_cell') return false
    return normalizedRanges.some(
      (range) => node.nodeIndex >= range.fromNodeIndex && node.nodeIndex <= range.toNodeIndex
    )
  })
  return {
    nodes: visibleNodes
  }
}

export const getDetailedNode = (index: NodeIndex, nodeId: string): DocxDetailedNode | null => {
  return index.detailByNodeId.get(nodeId) || null
}

export const getNodeStructureFacts = (
  index: NodeIndex,
  nodeId: string
): {
  nodeType: 'paragraph' | 'table' | 'table_cell' | 'content_control' | 'revision'
  nodeIndex: number
  previousNodeId?: string
  nextNodeId?: string
  tableNodeId?: string
  story: import('../../types').DocxStoryRef
} | null => {
  const node = index.nodesById.get(nodeId)
  if (!node) return null
  const storyNodeIds = index.rootNodeIds.filter(
    (candidateId) => index.nodesById.get(candidateId)?.story.storyId === node.story.storyId
  )
  return {
    nodeType: node.kind,
    nodeIndex: node.nodeIndex,
    ...resolveBodyNeighbors(storyNodeIds, nodeId),
    tableNodeId: node.kind === 'table_cell' ? node.tableNodeId : undefined,
    story: node.story
  }
}

export const extractNodeText = (index: NodeIndex, nodeId: string): string => {
  const detail = getDetailedNode(index, nodeId)
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
  const documentRelationships = await parsePartRelationships(zip, 'word/document.xml')
  const relationshipTargets = documentRelationships.targets
  const relationshipTypes = documentRelationships.types
  const relationshipTargetModes = documentRelationships.targetModes
  const availableRelationshipTargetIds = documentRelationships.availableTargetIds
  const stories: DocxStoryPart[] = [
    {
      story: { storyId: 'body', type: 'body' },
      partName: 'word/document.xml',
      dom: documentDom,
      root: getBody(documentDom),
      relationshipTargets,
      relationshipTypes,
      relationshipTargetModes,
      availableRelationshipTargetIds
    }
  ]
  const storyPartTypes = [
    ['header', 'header'],
    ['footer', 'footer'],
    ['footnotes', 'footnote'],
    ['endnotes', 'endnote']
  ] as const
  const loadedPartDoms = new Map<string, Document>([['word/document.xml', documentDom]])
  for (const [relationshipId, relationshipType] of relationshipTypes) {
    const match = storyPartTypes.find(([suffix]) => relationshipType.endsWith(`/${suffix}`))
    if (!match) continue
    const target = relationshipTargets.get(relationshipId) || ''
    const partName = resolveDocxRelationshipTarget(target, 'word/document.xml')
    if (!partName || loadedPartDoms.has(partName)) continue
    const xml = await readZipText(zip, partName)
    if (!xml) continue
    const dom = parseXml(xml)
    loadedPartDoms.set(partName, dom)
    const relationships = await parsePartRelationships(zip, partName)
    const [, type] = match
    if (type === 'footnote' || type === 'endnote') {
      const roots = Array.from(dom.getElementsByTagNameNS(WORD_NS, type))
      roots.forEach((root, index) => {
        const nativeId = getAttr(root, 'id') || String(index)
        stories.push({
          story: { storyId: `${type}:${partName}#${nativeId}`, type },
          partName,
          dom,
          root,
          relationshipTargets: relationships.targets,
          relationshipTypes: relationships.types,
          relationshipTargetModes: relationships.targetModes,
          availableRelationshipTargetIds: relationships.availableTargetIds
        })
      })
    } else {
      const root = dom.documentElement
      if (!root) continue
      stories.push({
        story: { storyId: `${type}:${partName}`, type },
        partName,
        dom,
        root,
        relationshipTargets: relationships.targets,
        relationshipTypes: relationships.types,
        relationshipTargetModes: relationships.targetModes,
        availableRelationshipTargetIds: relationships.availableTargetIds
      })
    }
  }
  for (const [partName, dom] of loadedPartDoms) {
    const relationships =
      partName === 'word/document.xml'
        ? documentRelationships
        : await parsePartRelationships(zip, partName)
    const textboxes = Array.from(dom.getElementsByTagNameNS(WORD_NS, 'txbxContent'))
    textboxes.forEach((root, index) => {
      stories.push({
        story: { storyId: `textbox:${partName}#${String(index)}`, type: 'textbox' },
        partName,
        dom,
        root,
        relationshipTargets: relationships.targets,
        relationshipTypes: relationships.types,
        relationshipTargetModes: relationships.targetModes,
        availableRelationshipTargetIds: relationships.availableTargetIds
      })
    })
  }
  return {
    zip,
    documentXml,
    documentDom,
    meta,
    relationshipTargets,
    relationshipTypes,
    relationshipTargetModes,
    availableRelationshipTargetIds,
    stories
  }
}
