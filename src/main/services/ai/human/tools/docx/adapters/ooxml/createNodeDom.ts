import type JSZip from 'jszip'
import path from 'node:path'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type {
  DocxBorder,
  DocxBorders,
  DocxCreateContainerChildNode,
  DocxCreateHyperlinkNode,
  DocxCreateParagraphNode,
  DocxCreateRunNode,
  DocxCreateTableCellNode,
  DocxCreateTableNode,
  DocxCreateTableRowNode,
  DocxLength
} from '../../types'
import { childElements } from './dom'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const HYPERLINK_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

const wordElement = (doc: Document, name: string): Element =>
  doc.createElementNS(WORD_NS, `w:${name}`)

const setWordAttr = (node: Element, name: string, value: string): void => {
  node.setAttributeNS(WORD_NS, `w:${name}`, value)
}

const setRelAttr = (node: Element, name: string, value: string): void => {
  node.setAttributeNS(REL_NS, `r:${name}`, value)
}

const ptToTwips = (value: number): string => String(Math.round(value * 20))
const ptToHalfPoints = (value: number): string => String(Math.round(value * 2))

const appendVal = (parent: Element, name: string, value: string): Element => {
  const node = wordElement(parent.ownerDocument, name)
  setWordAttr(node, 'val', value)
  parent.appendChild(node)
  return node
}

const appendToggle = (parent: Element, name: string, value: boolean | undefined): void => {
  if (value === undefined) return
  const node = wordElement(parent.ownerDocument, name)
  if (!value) setWordAttr(node, 'val', '0')
  parent.appendChild(node)
}

const widthAttrs = (node: Element, width: DocxLength): void => {
  setWordAttr(
    node,
    'w',
    String(Math.round(width.unit === 'percent' ? width.value * 50 : width.value * 20))
  )
  setWordAttr(node, 'type', width.unit === 'percent' ? 'pct' : 'dxa')
}

const borderName = (side: keyof DocxBorders): string => {
  if (side === 'insideHorizontal') return 'insideH'
  if (side === 'insideVertical') return 'insideV'
  return side
}

const appendBorders = (parent: Element, containerName: string, borders: DocxBorders): void => {
  const container = wordElement(parent.ownerDocument, containerName)
  ;(Object.entries(borders) as Array<[keyof DocxBorders, DocxBorder | undefined]>).forEach(
    ([side, border]) => {
      if (!border) return
      const node = wordElement(parent.ownerDocument, borderName(side))
      setWordAttr(node, 'val', border.style)
      if (border.color) setWordAttr(node, 'color', border.color)
      if (border.size !== undefined) setWordAttr(node, 'sz', String(Math.round(border.size * 8)))
      container.appendChild(node)
    }
  )
  if (container.childNodes.length > 0) parent.appendChild(container)
}

const createRunProperties = (doc: Document, node: DocxCreateRunNode): Element | null => {
  const style = node.style
  if (!style) return null
  const rPr = wordElement(doc, 'rPr')
  appendToggle(rPr, 'b', style.bold)
  appendToggle(rPr, 'i', style.italic)
  appendToggle(rPr, 'strike', style.strike)
  if (style.underline !== undefined) appendVal(rPr, 'u', style.underline ? 'single' : 'none')
  if (style.color) appendVal(rPr, 'color', style.color)
  if (style.highlight) {
    const shading = wordElement(doc, 'shd')
    setWordAttr(shading, 'fill', style.highlight)
    rPr.appendChild(shading)
  }
  if (style.fontFamily) {
    const fonts = wordElement(doc, 'rFonts')
    setWordAttr(fonts, 'ascii', style.fontFamily)
    setWordAttr(fonts, 'eastAsia', style.fontFamily)
    rPr.appendChild(fonts)
  }
  if (style.fontSize !== undefined) appendVal(rPr, 'sz', ptToHalfPoints(style.fontSize))
  return rPr.childNodes.length > 0 ? rPr : null
}

const createRun = (doc: Document, node: DocxCreateRunNode): Element => {
  const run = wordElement(doc, 'r')
  const properties = createRunProperties(doc, node)
  if (properties) run.appendChild(properties)
  node.children.forEach((child) => {
    if (child.type === 'text') {
      const text = wordElement(doc, 't')
      if (/^\s|\s$/.test(child.text)) text.setAttribute('xml:space', 'preserve')
      text.appendChild(doc.createTextNode(child.text))
      run.appendChild(text)
      return
    }
    if (child.type === 'tab') {
      run.appendChild(wordElement(doc, 'tab'))
      return
    }
    const br = wordElement(doc, 'br')
    if (child.kind && child.kind !== 'line') setWordAttr(br, 'type', child.kind)
    run.appendChild(br)
  })
  return run
}

export type DocxRelationshipWriter = {
  addHyperlink: (target: string) => string
  persist: () => Promise<void>
}

export const createRelationshipWriter = async (
  zip: JSZip,
  partName = 'word/document.xml'
): Promise<DocxRelationshipWriter> => {
  const entry = path.posix.join(
    path.posix.dirname(partName),
    '_rels',
    `${path.posix.basename(partName)}.rels`
  )
  const existing = await zip.file(entry)?.async('text')
  const doc = existing
    ? new DOMParser().parseFromString(existing, 'application/xml')
    : new DOMParser().parseFromString(
        `<Relationships xmlns="${PACKAGE_REL_NS}"/>`,
        'application/xml'
      )
  const root = doc.documentElement
  let nextId = 1
  childElements(root).forEach((relationship) => {
    const match = (relationship.getAttribute('Id') || '').match(/^rId(\d+)$/)
    if (match) nextId = Math.max(nextId, Number(match[1]) + 1)
  })
  return {
    addHyperlink: (target) => {
      const id = `rId${String(nextId++)}`
      const relationship = doc.createElementNS(PACKAGE_REL_NS, 'Relationship')
      relationship.setAttribute('Id', id)
      relationship.setAttribute('Type', HYPERLINK_REL)
      relationship.setAttribute('Target', target)
      relationship.setAttribute('TargetMode', 'External')
      root.appendChild(relationship)
      return id
    },
    persist: async () => {
      zip.file(entry, new XMLSerializer().serializeToString(doc))
    }
  }
}

const createHyperlink = (
  doc: Document,
  node: DocxCreateHyperlinkNode,
  relationships: DocxRelationshipWriter
): Element => {
  const hyperlink = wordElement(doc, 'hyperlink')
  if (node.target) setRelAttr(hyperlink, 'id', relationships.addHyperlink(node.target))
  if (node.anchor) setWordAttr(hyperlink, 'anchor', node.anchor)
  node.children.forEach((run) => hyperlink.appendChild(createRun(doc, run)))
  return hyperlink
}

const createParagraphProperties = (
  doc: Document,
  node: DocxCreateParagraphNode
): Element | null => {
  const style = node.style
  if (!style) return null
  const pPr = wordElement(doc, 'pPr')
  if (style.styleName) appendVal(pPr, 'pStyle', style.styleName)
  if (style.alignment) appendVal(pPr, 'jc', style.alignment)
  if (style.indent) {
    const indent = wordElement(doc, 'ind')
    if (style.indent.left !== undefined) setWordAttr(indent, 'left', ptToTwips(style.indent.left))
    if (style.indent.right !== undefined)
      setWordAttr(indent, 'right', ptToTwips(style.indent.right))
    if (style.indent.firstLine !== undefined)
      setWordAttr(indent, 'firstLine', ptToTwips(style.indent.firstLine))
    if (style.indent.hanging !== undefined)
      setWordAttr(indent, 'hanging', ptToTwips(style.indent.hanging))
    pPr.appendChild(indent)
  }
  if (style.spacing) {
    const spacing = wordElement(doc, 'spacing')
    if (style.spacing.before !== undefined)
      setWordAttr(spacing, 'before', ptToTwips(style.spacing.before))
    if (style.spacing.after !== undefined)
      setWordAttr(spacing, 'after', ptToTwips(style.spacing.after))
    if (style.spacing.line !== undefined)
      setWordAttr(spacing, 'line', ptToTwips(style.spacing.line))
    pPr.appendChild(spacing)
  }
  appendToggle(pPr, 'keepNext', style.keepWithNext)
  appendToggle(pPr, 'pageBreakBefore', style.pageBreakBefore)
  return pPr.childNodes.length > 0 ? pPr : null
}

export const createParagraphFromNode = (
  doc: Document,
  node: DocxCreateParagraphNode,
  relationships: DocxRelationshipWriter
): Element => {
  const paragraph = wordElement(doc, 'p')
  const properties = createParagraphProperties(doc, node)
  if (properties) paragraph.appendChild(properties)
  node.children.forEach((child) => {
    paragraph.appendChild(
      child.type === 'run' ? createRun(doc, child) : createHyperlink(doc, child, relationships)
    )
  })
  return paragraph
}

const createCell = (
  doc: Document,
  node: DocxCreateTableCellNode,
  relationships: DocxRelationshipWriter
): Element => {
  const cell = wordElement(doc, 'tc')
  if (node.style) {
    const tcPr = wordElement(doc, 'tcPr')
    if (node.style.width) {
      const width = wordElement(doc, 'tcW')
      widthAttrs(width, node.style.width)
      tcPr.appendChild(width)
    }
    if (node.style.verticalAlignment) appendVal(tcPr, 'vAlign', node.style.verticalAlignment)
    if (node.style.shading) {
      const shading = wordElement(doc, 'shd')
      setWordAttr(shading, 'fill', node.style.shading)
      tcPr.appendChild(shading)
    }
    if (node.style.margins) {
      const margins = wordElement(doc, 'tcMar')
      ;(Object.entries(node.style.margins) as Array<[string, number | undefined]>).forEach(
        ([side, value]) => {
          if (value === undefined) return
          const margin = wordElement(doc, side)
          setWordAttr(margin, 'w', ptToTwips(value))
          setWordAttr(margin, 'type', 'dxa')
          margins.appendChild(margin)
        }
      )
      tcPr.appendChild(margins)
    }
    if (node.style.borders) appendBorders(tcPr, 'tcBorders', node.style.borders)
    if (tcPr.childNodes.length > 0) cell.appendChild(tcPr)
  }
  node.children.forEach((child) => cell.appendChild(createNodeFromNode(doc, child, relationships)))
  const last = cell.lastChild
  if (!last || !('localName' in last) || (last as Element).localName !== 'p') {
    cell.appendChild(
      createParagraphFromNode(
        doc,
        { type: 'paragraph', children: [{ type: 'run', children: [{ type: 'text', text: '' }] }] },
        relationships
      )
    )
  }
  return cell
}

const createRow = (
  doc: Document,
  node: DocxCreateTableRowNode,
  relationships: DocxRelationshipWriter
): Element => {
  const row = wordElement(doc, 'tr')
  if (node.style) {
    const trPr = wordElement(doc, 'trPr')
    if (node.style.height !== undefined) {
      const height = wordElement(doc, 'trHeight')
      setWordAttr(height, 'val', ptToTwips(node.style.height))
      trPr.appendChild(height)
    }
    appendToggle(trPr, 'tblHeader', node.style.repeatHeader)
    appendToggle(trPr, 'cantSplit', node.style.cantSplit)
    if (trPr.childNodes.length > 0) row.appendChild(trPr)
  }
  node.children.forEach((cell) => row.appendChild(createCell(doc, cell, relationships)))
  return row
}

const createTable = (
  doc: Document,
  node: DocxCreateTableNode,
  relationships: DocxRelationshipWriter
): Element => {
  const table = wordElement(doc, 'tbl')
  const tblPr = wordElement(doc, 'tblPr')
  if (node.style?.alignment) appendVal(tblPr, 'jc', node.style.alignment)
  if (node.style?.width) {
    const width = wordElement(doc, 'tblW')
    widthAttrs(width, node.style.width)
    tblPr.appendChild(width)
  }
  if (node.style?.layout) appendVal(tblPr, 'tblLayout', node.style.layout)
  if (node.style?.borders) appendBorders(tblPr, 'tblBorders', node.style.borders)
  if (tblPr.childNodes.length > 0) table.appendChild(tblPr)
  node.children.forEach((row) => table.appendChild(createRow(doc, row, relationships)))
  return table
}

export const createNodeFromNode = (
  doc: Document,
  node: DocxCreateContainerChildNode,
  relationships: DocxRelationshipWriter
): Element =>
  node.type === 'paragraph'
    ? createParagraphFromNode(doc, node, relationships)
    : createTable(doc, node, relationships)

export const replaceCellContentFromNodes = (
  cell: Element,
  children: readonly DocxCreateContainerChildNode[],
  relationships: DocxRelationshipWriter
): void => {
  childElements(cell)
    .filter((child) => child.localName !== 'tcPr')
    .forEach((child) => cell.removeChild(child))
  children.forEach((child) =>
    cell.appendChild(createNodeFromNode(cell.ownerDocument, child, relationships))
  )
  const last = cell.lastChild
  if (!last || !('localName' in last) || (last as Element).localName !== 'p') {
    cell.appendChild(
      createParagraphFromNode(
        cell.ownerDocument,
        { type: 'paragraph', children: [{ type: 'run', children: [{ type: 'text', text: '' }] }] },
        relationships
      )
    )
  }
}

export const createNodeText = (node: DocxCreateContainerChildNode): string => {
  if (node.type === 'paragraph') {
    return node.children
      .flatMap((child) => (child.type === 'run' ? [child] : child.children))
      .flatMap((run) => run.children)
      .map((child) => (child.type === 'text' ? child.text : child.type === 'tab' ? '\t' : '\n'))
      .join('')
  }
  return node.children
    .flatMap((row) => row.children)
    .flatMap((cell) => cell.children)
    .map(createNodeText)
    .join('\n')
}
