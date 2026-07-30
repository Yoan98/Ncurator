import path from 'node:path'
import type {
  DocxDetailedBlock,
  DocxDetailedCellBlock,
  DocxDetailedParagraphBlock,
  DocxDetailedTableBlock,
  DocxBorders,
  DocxParagraphStyle,
  DocxReadBlockNode,
  DocxReadContentControlNode,
  DocxReadFieldNode,
  DocxReadHyperlinkNode,
  DocxReadInlineNode,
  DocxReadNode,
  DocxReadParagraphNode,
  DocxReadRevisionNode,
  DocxReadRunChildNode,
  DocxReadRunNode,
  DocxReadTableCellNode,
  DocxReadTableNode,
  DocxReadTableRowNode,
  DocxReadVisualNode,
  DocxRunStyle,
  DocxTableCellStyle,
  DocxTableRowStyle,
  DocxTableStyle,
  DocxVisualSummary
} from '../../types'
import type { DocxEditableNode, DocxVisualDescriptor } from './types'
import { childElements, descendantElements, firstChildElement, getAttr } from './dom'

type SemanticTreeContext = {
  blockId: string
  relationshipTargets: ReadonlyMap<string, string>
  relationshipTypes: ReadonlyMap<string, string>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}

const nodeId = (context: SemanticTreeContext, nodePath: string): string =>
  `node:${context.blockId}:${nodePath}`

const visualId = (context: SemanticTreeContext, nodePath: string): string =>
  `visual:${context.blockId}:${nodePath}`

const attrByLocalName = (node: Element, names: readonly string[]): string => {
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attr = node.attributes.item(index)
    if (attr && names.includes(attr.localName || attr.name)) return attr.value
  }
  return ''
}

const boolProperty = (parent: Element | null, name: string): boolean | undefined => {
  if (!parent) return undefined
  const node = firstChildElement(parent, name)
  if (!node) return undefined
  const value = getAttr(node, 'val').toLowerCase()
  return value === '0' || value === 'false' || value === 'off' ? false : true
}

const numberAttr = (node: Element | null, name: string): number | undefined => {
  if (!node) return undefined
  const raw = getAttr(node, name).trim()
  if (!raw) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

const twipsToPt = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : value / 20

const halfPointsToPt = (value: number | undefined): number | undefined =>
  value === undefined ? undefined : value / 2

const compact = <T extends object>(value: T): T | undefined =>
  Object.values(value).some((entry) => entry !== undefined) ? value : undefined

const hexColor = (value: string): string | undefined =>
  /^[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : undefined

const readBorders = (properties: Element, containerName: string): DocxBorders | undefined => {
  const container = firstChildElement(properties, containerName)
  if (!container) return undefined
  const names: Record<string, keyof DocxBorders> = {
    top: 'top',
    right: 'right',
    bottom: 'bottom',
    left: 'left',
    insideH: 'insideHorizontal',
    insideV: 'insideVertical'
  }
  const borders: DocxBorders = {}
  childElements(container).forEach((node) => {
    const side = names[node.localName]
    if (!side) return
    const value = getAttr(node, 'val')
    const allowed = ['none', 'single', 'dashed', 'dotted', 'double'] as const
    borders[side] = {
      style: allowed.includes(value as (typeof allowed)[number])
        ? (value as (typeof allowed)[number])
        : 'single',
      color: hexColor(getAttr(node, 'color')),
      size: numberAttr(node, 'sz') === undefined ? undefined : numberAttr(node, 'sz')! / 8
    }
  })
  return Object.keys(borders).length > 0 ? borders : undefined
}

export const readRunStyle = (run: Element): DocxRunStyle | undefined => {
  const rPr = firstChildElement(run, 'rPr')
  if (!rPr) return undefined
  const color = firstChildElement(rPr, 'color')
  const highlight = firstChildElement(rPr, 'shd')
  const fonts = firstChildElement(rPr, 'rFonts')
  const size = firstChildElement(rPr, 'sz')
  return compact({
    bold: boolProperty(rPr, 'b'),
    italic: boolProperty(rPr, 'i'),
    underline: firstChildElement(rPr, 'u') ? boolProperty(rPr, 'u') : undefined,
    strike: boolProperty(rPr, 'strike'),
    color: color ? hexColor(getAttr(color, 'val')) : undefined,
    highlight: highlight ? hexColor(getAttr(highlight, 'fill')) : undefined,
    fontFamily: fonts
      ? getAttr(fonts, 'ascii') || getAttr(fonts, 'eastAsia') || undefined
      : undefined,
    fontSize: halfPointsToPt(numberAttr(size, 'val'))
  })
}

export const readParagraphStyle = (paragraph: Element): DocxParagraphStyle | undefined => {
  const pPr = firstChildElement(paragraph, 'pPr')
  if (!pPr) return undefined
  const style = firstChildElement(pPr, 'pStyle')
  const alignment = firstChildElement(pPr, 'jc')
  const indent = firstChildElement(pPr, 'ind')
  const spacing = firstChildElement(pPr, 'spacing')
  return compact({
    styleName: style ? getAttr(style, 'val') || undefined : undefined,
    alignment: alignment
      ? (getAttr(alignment, 'val') as DocxParagraphStyle['alignment']) || undefined
      : undefined,
    indent: indent
      ? compact({
          left: twipsToPt(numberAttr(indent, 'left')),
          right: twipsToPt(numberAttr(indent, 'right')),
          firstLine: twipsToPt(numberAttr(indent, 'firstLine')),
          hanging: twipsToPt(numberAttr(indent, 'hanging'))
        })
      : undefined,
    spacing: spacing
      ? compact({
          before: twipsToPt(numberAttr(spacing, 'before')),
          after: twipsToPt(numberAttr(spacing, 'after')),
          line: twipsToPt(numberAttr(spacing, 'line'))
        })
      : undefined,
    keepWithNext: boolProperty(pPr, 'keepNext'),
    pageBreakBefore: boolProperty(pPr, 'pageBreakBefore')
  })
}

const readTableStyle = (table: Element): DocxTableStyle | undefined => {
  const tblPr = firstChildElement(table, 'tblPr')
  if (!tblPr) return undefined
  const alignment = firstChildElement(tblPr, 'jc')
  const width = firstChildElement(tblPr, 'tblW')
  const layout = firstChildElement(tblPr, 'tblLayout')
  const widthType = width ? getAttr(width, 'type') : ''
  const widthValue = width ? numberAttr(width, 'w') : undefined
  return compact({
    alignment: alignment
      ? (getAttr(alignment, 'val') as DocxTableStyle['alignment']) || undefined
      : undefined,
    width:
      widthValue === undefined
        ? undefined
        : widthType === 'pct'
          ? { value: widthValue / 50, unit: 'percent' as const }
          : { value: widthValue / 20, unit: 'pt' as const },
    layout: layout ? (getAttr(layout, 'type') === 'autofit' ? 'autofit' : 'fixed') : undefined,
    borders: readBorders(tblPr, 'tblBorders')
  })
}

const readRowStyle = (row: Element): DocxTableRowStyle | undefined => {
  const trPr = firstChildElement(row, 'trPr')
  if (!trPr) return undefined
  const height = firstChildElement(trPr, 'trHeight')
  return compact({
    height: twipsToPt(numberAttr(height, 'val')),
    repeatHeader: boolProperty(trPr, 'tblHeader'),
    cantSplit: boolProperty(trPr, 'cantSplit')
  })
}

const readCellStyle = (cell: Element): DocxTableCellStyle | undefined => {
  const tcPr = firstChildElement(cell, 'tcPr')
  if (!tcPr) return undefined
  const width = firstChildElement(tcPr, 'tcW')
  const vertical = firstChildElement(tcPr, 'vAlign')
  const shading = firstChildElement(tcPr, 'shd')
  const margins = firstChildElement(tcPr, 'tcMar')
  const widthType = width ? getAttr(width, 'type') : ''
  const widthValue = width ? numberAttr(width, 'w') : undefined
  return compact({
    width:
      widthValue === undefined
        ? undefined
        : widthType === 'pct'
          ? { value: widthValue / 50, unit: 'percent' as const }
          : { value: widthValue / 20, unit: 'pt' as const },
    verticalAlignment: vertical
      ? (getAttr(vertical, 'val') as DocxTableCellStyle['verticalAlignment']) || undefined
      : undefined,
    shading: shading ? hexColor(getAttr(shading, 'fill')) : undefined,
    margins: margins
      ? compact({
          top: twipsToPt(numberAttr(firstChildElement(margins, 'top'), 'w')),
          right: twipsToPt(numberAttr(firstChildElement(margins, 'right'), 'w')),
          bottom: twipsToPt(numberAttr(firstChildElement(margins, 'bottom'), 'w')),
          left: twipsToPt(numberAttr(firstChildElement(margins, 'left'), 'w'))
        })
      : undefined,
    borders: readBorders(tcPr, 'tcBorders')
  })
}

const firstDescendant = (node: Element, localName: string): Element | undefined =>
  descendantElements(node, localName)[0]

const classifyVisual = (node: Element): DocxVisualDescriptor['kind'] => {
  if (firstDescendant(node, 'OLEObject') || firstDescendant(node, 'oleObject')) {
    return 'embedded_object'
  }
  if (firstDescendant(node, 'chart')) return 'chart'
  if (firstDescendant(node, 'relIds')) return 'diagram'
  if (
    firstDescendant(node, 'pic') ||
    firstDescendant(node, 'blip') ||
    firstDescendant(node, 'imagedata')
  ) {
    return 'image'
  }
  return 'shape'
}

const visualRelationshipId = (node: Element, kind: DocxVisualDescriptor['kind']): string => {
  if (kind === 'embedded_object') {
    const preview = firstDescendant(node, 'imagedata')
    if (preview) return attrByLocalName(preview, ['id', 'embed'])
  }
  const candidate =
    firstDescendant(node, 'blip') ||
    firstDescendant(node, 'imagedata') ||
    firstDescendant(node, 'chart') ||
    firstDescendant(node, 'relIds') ||
    firstDescendant(node, 'OLEObject')
  return candidate ? attrByLocalName(candidate, ['embed', 'link', 'id', 'dm']) : ''
}

const visualAltText = (node: Element): string | undefined => {
  const docPr = firstDescendant(node, 'docPr') || firstDescendant(node, 'cNvPr')
  if (!docPr) return undefined
  return (
    attrByLocalName(docPr, ['descr']) ||
    attrByLocalName(docPr, ['title']) ||
    attrByLocalName(docPr, ['name']) ||
    undefined
  )
}

const selectAlternateContent = (node: Element): Element[] => {
  if (node.localName !== 'AlternateContent') return [node]
  const supportedNamespaces = new Set([
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
    return requirements.length > 0 && requirements.every((item) => supportedNamespaces.has(item))
  })
  const fallback = childElements(node).find((child) => child.localName === 'Fallback')
  return choice ? childElements(choice) : fallback ? childElements(fallback) : []
}

const parseVisual = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadVisualNode => {
  const kind = classifyVisual(node)
  const relationshipId = visualRelationshipId(node, kind) || undefined
  const id = visualId(context, currentPath)
  const target = relationshipId ? context.relationshipTargets.get(relationshipId) : undefined
  const descriptor: DocxVisualDescriptor = {
    visualId: id,
    blockId: context.blockId,
    kind,
    relationshipId,
    target,
    contentType: relationshipId ? context.relationshipTypes.get(relationshipId) : undefined
  }
  context.visualsById.set(id, descriptor)

  const textBox = firstDescendant(node, 'txbxContent')
  const children = textBox
    ? childElements(textBox)
        .map((child, index) => parseBlockNode(child, context, `${currentPath}.textbox.${index}`))
        .filter((child): child is DocxReadBlockNode => Boolean(child))
    : []
  return {
    type: 'visual',
    visualId: id,
    kind,
    altText: visualAltText(node),
    children: children.length > 0 ? children : undefined
  }
}

const parseRun = (
  run: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadRunNode => {
  const id = nodeId(context, currentPath)
  context.editableNodesById.set(id, {
    nodeId: id,
    blockId: context.blockId,
    kind: 'run',
    node: run
  })
  const children: DocxReadRunChildNode[] = []
  childElements(run).forEach((child, index) => {
    const childPath = `${currentPath}.${index}`
    if (child.localName === 't' || child.localName === 'delText') {
      children.push({ type: 'text', text: child.textContent || '' })
      return
    }
    if (child.localName === 'tab') {
      children.push({ type: 'tab' })
      return
    }
    if (child.localName === 'br' || child.localName === 'cr') {
      const kind = getAttr(child, 'type')
      children.push({
        type: 'break',
        kind: kind === 'page' || kind === 'column' ? kind : 'line'
      })
      return
    }
    if (
      child.localName === 'drawing' ||
      child.localName === 'pict' ||
      child.localName === 'object'
    ) {
      children.push(parseVisual(child, context, childPath))
      return
    }
    if (child.localName === 'AlternateContent') {
      selectAlternateContent(child).forEach((selected, selectedIndex) => {
        if (
          selected.localName === 'drawing' ||
          selected.localName === 'pict' ||
          selected.localName === 'object'
        ) {
          children.push(parseVisual(selected, context, `${childPath}.${selectedIndex}`))
        }
      })
    }
  })
  return {
    type: 'run',
    nodeId: id,
    style: readRunStyle(run),
    children
  }
}

const parseHyperlink = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadHyperlinkNode => {
  const relationshipId = attrByLocalName(node, ['id'])
  return {
    type: 'hyperlink',
    target: relationshipId ? context.relationshipTargets.get(relationshipId) : undefined,
    anchor: getAttr(node, 'anchor') || undefined,
    children: childElements(node, 'r').map((run, index) =>
      parseRun(run, context, `${currentPath}.${index}`)
    )
  }
}

const revisionKind = (name: string): DocxReadRevisionNode['kind'] => {
  if (name === 'del') return 'delete'
  if (name === 'moveFrom') return 'move_from'
  if (name === 'moveTo') return 'move_to'
  return 'insert'
}

const parseContainerChildren = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadNode[] =>
  childElements(node).flatMap((child, index) =>
    parseSemanticElement(child, context, `${currentPath}.${index}`)
  )

const parseContentControl = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadContentControlNode => {
  const properties = firstChildElement(node, 'sdtPr')
  const tag = properties ? firstChildElement(properties, 'tag') : null
  const content = firstChildElement(node, 'sdtContent')
  return {
    type: 'content_control',
    tag: tag ? getAttr(tag, 'val') || undefined : undefined,
    children: content ? parseContainerChildren(content, context, currentPath) : []
  }
}

const parseSimpleField = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadFieldNode => ({
  type: 'field',
  instruction: getAttr(node, 'instr'),
  children: parseContainerChildren(node, context, currentPath)
})

const parseSemanticElement = (
  child: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadNode[] => {
  if (child.localName === 'r') return [parseRun(child, context, currentPath)]
  if (child.localName === 'hyperlink') return [parseHyperlink(child, context, currentPath)]
  if (child.localName === 'sdt') return [parseContentControl(child, context, currentPath)]
  if (['ins', 'del', 'moveFrom', 'moveTo'].includes(child.localName)) {
    return [
      {
        type: 'revision',
        kind: revisionKind(child.localName),
        children: parseContainerChildren(child, context, currentPath)
      }
    ]
  }
  if (child.localName === 'fldSimple') return [parseSimpleField(child, context, currentPath)]
  if (child.localName === 'p' || child.localName === 'tbl') {
    const block = parseBlockNode(child, context, currentPath)
    return block ? [block] : []
  }
  if (child.localName === 'AlternateContent') {
    return selectAlternateContent(child).flatMap((selected, index) =>
      parseSemanticElement(selected, context, `${currentPath}.${index}`)
    )
  }
  return parseContainerChildren(child, context, currentPath)
}

const containsFieldChar = (run: Element, kind: string): boolean =>
  childElements(run, 'fldChar').some((node) => getAttr(node, 'fldCharType') === kind)

const parseParagraphChildren = (
  paragraph: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadInlineNode[] => {
  const result: DocxReadInlineNode[] = []
  let field: { instruction: string; children: DocxReadNode[]; readingResult: boolean } | null = null
  childElements(paragraph).forEach((child, index) => {
    if (child.localName === 'pPr') return
    const childPath = `${currentPath}.${index}`
    if (child.localName === 'r' && containsFieldChar(child, 'begin')) {
      field = { instruction: '', children: [], readingResult: false }
      return
    }
    if (field && child.localName === 'r') {
      const activeField = field as {
        instruction: string
        children: DocxReadNode[]
        readingResult: boolean
      }
      childElements(child, 'instrText').forEach((instruction) => {
        activeField.instruction += instruction.textContent || ''
      })
      if (containsFieldChar(child, 'separate')) activeField.readingResult = true
      if (
        activeField.readingResult &&
        !containsFieldChar(child, 'separate') &&
        !containsFieldChar(child, 'end')
      ) {
        activeField.children.push(parseRun(child, context, childPath))
      }
      if (containsFieldChar(child, 'end')) {
        result.push({
          type: 'field',
          instruction: activeField.instruction.trim(),
          children: activeField.children
        })
        field = null
      }
      return
    }
    result.push(...(parseSemanticElement(child, context, childPath) as DocxReadInlineNode[]))
  })
  return result
}

export const readNodeText = (node: DocxReadNode): string => {
  if (node.type === 'text') return node.text
  if (node.type === 'tab') return '\t'
  if (node.type === 'break') return '\n'
  if (node.type === 'revision' && (node.kind === 'delete' || node.kind === 'move_from')) return ''
  if (!('children' in node) || !node.children) return ''
  return node.children.map((child) => readNodeText(child)).join('')
}

const parseParagraph = (
  paragraph: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadParagraphNode => {
  const id = nodeId(context, currentPath)
  context.editableNodesById.set(id, {
    nodeId: id,
    blockId: context.blockId,
    kind: 'paragraph',
    node: paragraph
  })
  const children = parseParagraphChildren(paragraph, context, currentPath)
  const node: DocxReadParagraphNode = {
    type: 'paragraph',
    nodeId: id,
    style: readParagraphStyle(paragraph),
    text: '',
    children
  }
  node.text = children.map((child) => readNodeText(child)).join('')
  return node
}

const parseCell = (
  cell: Element,
  context: SemanticTreeContext,
  currentPath: string,
  row: number,
  col: number,
  cellBlockId?: string
): DocxReadTableCellNode => {
  const cellContext = cellBlockId ? { ...context, blockId: cellBlockId } : context
  const id = cellBlockId ? undefined : nodeId(context, currentPath)
  if (id) {
    context.editableNodesById.set(id, {
      nodeId: id,
      blockId: context.blockId,
      kind: 'table_cell',
      node: cell
    })
  }
  const children = childElements(cell)
    .map((child, index) => parseBlockNode(child, cellContext, `${currentPath}.${index}`))
    .filter((child): child is DocxReadBlockNode => Boolean(child))
  return {
    type: 'table_cell',
    ...(cellBlockId ? { blockId: cellBlockId } : { nodeId: id! }),
    row,
    col,
    style: readCellStyle(cell),
    text: children.map((child) => readNodeText(child)).join('\n'),
    children
  }
}

const parseTable = (
  table: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadTableNode => {
  const id = nodeId(context, currentPath)
  context.editableNodesById.set(id, {
    nodeId: id,
    blockId: context.blockId,
    kind: 'table',
    node: table
  })
  const rows = childElements(table, 'tr').map((row, rowIndex): DocxReadTableRowNode => {
    const rowPath = `${currentPath}.row.${rowIndex}`
    const rowId = nodeId(context, rowPath)
    context.editableNodesById.set(rowId, {
      nodeId: rowId,
      blockId: context.blockId,
      kind: 'table_row',
      node: row
    })
    return {
      type: 'table_row',
      nodeId: rowId,
      row: rowIndex + 1,
      style: readRowStyle(row),
      children: childElements(row, 'tc').map((cell, colIndex) =>
        parseCell(
          cell,
          context,
          `${rowPath}.cell.${colIndex}`,
          rowIndex + 1,
          colIndex + 1,
          currentPath === 'root'
            ? `${context.blockId}.r:${String(rowIndex + 1)}.c:${String(colIndex + 1)}`
            : undefined
        )
      )
    }
  })
  const cols = rows.reduce((max, row) => Math.max(max, row.children.length), 0)
  return {
    type: 'table',
    nodeId: id,
    style: readTableStyle(table),
    rows: rows.length,
    cols,
    text: rows
      .flatMap((row) => row.children)
      .map((cell) => cell.text)
      .filter(Boolean)
      .join(' | '),
    children: rows
  }
}

const parseBlockNode = (
  node: Element,
  context: SemanticTreeContext,
  currentPath: string
): DocxReadBlockNode | null => {
  if (node.localName === 'p') return parseParagraph(node, context, currentPath)
  if (node.localName === 'tbl') return parseTable(node, context, currentPath)
  if (node.localName === 'sdt') return parseContentControl(node, context, currentPath)
  if (['ins', 'del', 'moveFrom', 'moveTo'].includes(node.localName)) {
    return {
      type: 'revision',
      kind: revisionKind(node.localName),
      children: parseContainerChildren(node, context, currentPath)
    }
  }
  return null
}

const createContext = (input: {
  blockId: string
  relationshipTargets: ReadonlyMap<string, string>
  relationshipTypes: ReadonlyMap<string, string>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}): SemanticTreeContext => ({ ...input })

export const buildParagraphDetail = (input: {
  blockId: string
  blockIndex: number
  layoutMode: DocxDetailedParagraphBlock['layoutMode']
  paragraph: Element
  previousBlockId?: string
  nextBlockId?: string
  relationshipTargets: ReadonlyMap<string, string>
  relationshipTypes: ReadonlyMap<string, string>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}): DocxDetailedParagraphBlock => {
  const parsed = parseParagraph(input.paragraph, createContext(input), 'root')
  const { nodeId: _nodeId, ...content } = parsed
  return {
    ...content,
    blockId: input.blockId,
    blockIndex: input.blockIndex,
    layoutMode: input.layoutMode,
    previousBlockId: input.previousBlockId,
    nextBlockId: input.nextBlockId
  }
}

export const buildTableDetail = (input: {
  blockId: string
  blockIndex: number
  layoutMode: DocxDetailedTableBlock['layoutMode']
  table: Element
  previousBlockId?: string
  nextBlockId?: string
  relationshipTargets: ReadonlyMap<string, string>
  relationshipTypes: ReadonlyMap<string, string>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}): DocxDetailedTableBlock => {
  const parsed = parseTable(input.table, createContext(input), 'root')
  const { nodeId: _nodeId, ...content } = parsed
  return {
    ...content,
    blockId: input.blockId,
    blockIndex: input.blockIndex,
    layoutMode: input.layoutMode,
    previousBlockId: input.previousBlockId,
    nextBlockId: input.nextBlockId
  }
}

export const buildCellDetail = (input: {
  blockId: string
  tableBlockId: string
  blockIndex: number
  layoutMode: DocxDetailedCellBlock['layoutMode']
  row: number
  col: number
  cell: Element
  previousBlockId?: string
  nextBlockId?: string
  relationshipTargets: ReadonlyMap<string, string>
  relationshipTypes: ReadonlyMap<string, string>
  editableNodesById: Map<string, DocxEditableNode>
  visualsById: Map<string, DocxVisualDescriptor>
}): DocxDetailedCellBlock => {
  const parsed = parseCell(input.cell, createContext(input), 'root', input.row, input.col)
  return {
    blockId: input.blockId,
    tableBlockId: input.tableBlockId,
    blockIndex: input.blockIndex,
    layoutMode: input.layoutMode,
    previousBlockId: input.previousBlockId,
    nextBlockId: input.nextBlockId,
    type: 'table_cell',
    row: input.row,
    col: input.col,
    style: parsed.style,
    text: parsed.text,
    children: parsed.children
  }
}

const collectVisualKinds = (node: DocxReadNode, out: DocxReadVisualNode[]): void => {
  if (node.type === 'visual') out.push(node)
  if ('children' in node && node.children) {
    node.children.forEach((child) => collectVisualKinds(child, out))
  }
}

export const visualSummaryForBlock = (block: DocxDetailedBlock): DocxVisualSummary | undefined => {
  const visuals: DocxReadVisualNode[] = []
  block.children.forEach((child) => collectVisualKinds(child, visuals))
  if (visuals.length === 0) return undefined
  return {
    count: visuals.length,
    kinds: [...new Set(visuals.map((visual) => visual.kind))]
  }
}

export const resolveRelationshipTarget = (target: string): string => {
  const normalized = path.posix.normalize(path.posix.join('word', target))
  return normalized.startsWith('../') ? normalized.slice(3) : normalized
}
