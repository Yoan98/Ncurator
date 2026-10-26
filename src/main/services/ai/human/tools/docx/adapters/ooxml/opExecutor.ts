import fs from 'node:fs/promises'
import path from 'node:path'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type JSZip from 'jszip'
import type { DocxBorders, DocxChangedNode, DocxOperation, DocxStylePatch } from '../../types'
import { normalizeDocxHexColor } from '../../utils/color'
import { buildDocumentNodeIndex, extractNodeText, loadDocxBundle } from './nodeIndex'
import { createParagraphFromNode, createRelationshipWriter } from './createNodeDom'
import { resolveDocxRelationshipTarget } from './relationshipPath'
import {
  childElements,
  collectText,
  descendantElements,
  firstChildElement,
  getAttr,
  isElementNode
} from './dom'
import type { ApplyOpsResult, DocxVisualDescriptor, NodeIndex } from './types'
import { isRootNode, isVisualNode } from './types'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PACKAGE_REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const WORDPROCESSING_DRAWING_NS =
  'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
const PICTURE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const IMAGE_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
const PICTURE_GRAPHIC_URI = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const CONTENT_TYPES_NS = 'http://schemas.openxmlformats.org/package/2006/content-types'
const COMMENTS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'
const COMMENTS_EXTENDED_REL_TYPE =
  'http://schemas.microsoft.com/office/2011/relationships/commentsExtended'
const STYLES_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'
const SETTINGS_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings'
const NUMBERING_REL_TYPE =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
const WORD_2010_NS = 'http://schemas.microsoft.com/office/word/2010/wordml'
const WORD_2012_NS = 'http://schemas.microsoft.com/office/word/2012/wordml'

const wordElement = (doc: Document, name: string): Element =>
  doc.createElementNS(WORD_NS, `w:${name}`)

const setWordAttr = (node: Element, name: string, value: string): void => {
  node.setAttributeNS(WORD_NS, `w:${name}`, value)
}

const namespacedElement = (
  doc: Document,
  namespace: string,
  prefix: string,
  name: string
): Element => doc.createElementNS(namespace, `${prefix}:${name}`)

const setRelAttr = (node: Element, name: string, value: string): void => {
  node.setAttributeNS(REL_NS, `r:${name}`, value)
}

const attrByLocalName = (node: Element, name: string): string => {
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attr = node.attributes.item(index)
    if (attr?.localName === name) return attr.value
  }
  return ''
}

const collectRelationshipIds = (node: Element): string[] => {
  const ids = new Set<string>()
  const visit = (current: Element): void => {
    for (let index = 0; index < current.attributes.length; index += 1) {
      const attr = current.attributes.item(index)
      if (attr && ['embed', 'link', 'id', 'dm'].includes(attr.localName) && attr.value) {
        ids.add(attr.value)
      }
    }
    childElements(current).forEach(visit)
  }
  visit(node)
  return [...ids]
}

const isRelationshipReferenced = (root: Element, relationshipId: string): boolean =>
  ['embed', 'link', 'id', 'dm'].some(
    (attributeName) => attrByLocalName(root, attributeName) === relationshipId
  ) || childElements(root).some((child) => isRelationshipReferenced(child, relationshipId))

const setText = (node: Element, value: string): void => {
  while (node.firstChild) node.removeChild(node.firstChild)
  node.appendChild(node.ownerDocument.createTextNode(value))
  if (/^\s|\s$/.test(value)) node.setAttribute('xml:space', 'preserve')
  else node.removeAttribute('xml:space')
}

const writeDocumentXml = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>
): Promise<Buffer> => {
  await cleanupUnusedImageRelationships(bundle)
  const domByPartName = new Map<string, Document>([['word/document.xml', bundle.documentDom]])
  bundle.stories.forEach((part) => domByPartName.set(part.partName, part.dom))
  domByPartName.forEach((dom, partName) => {
    bundle.zip.file(partName, new XMLSerializer().serializeToString(dom))
  })
  return await bundle.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

const writeZip = async (zip: JSZip): Promise<Buffer> =>
  await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

const storyDocuments = (bundle: Awaited<ReturnType<typeof loadDocxBundle>>): Document[] => [
  ...new Set([bundle.documentDom, ...bundle.stories.map((story) => story.dom)])
]

const documentForPart = (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  partName: string
): Document => {
  if (partName === 'word/document.xml') return bundle.documentDom
  const story = bundle.stories.find((candidate) => candidate.partName === partName)
  if (!story) throw new Error(`DOCX story part not found: ${partName}`)
  return story.dom
}

const buildCurrentIndex = (bundle: Awaited<ReturnType<typeof loadDocxBundle>>): NodeIndex =>
  buildDocumentNodeIndex(bundle)

const editableElement = (index: NodeIndex, id: string): Element => {
  const node = index.nodesById.get(id)
  if (node) return node.node
  throw new Error(`DOCX node not found: ${id}`)
}

const ownerNodeId = (index: NodeIndex, id: string): string => {
  const node = index.nodesById.get(id)
  if (node) return isRootNode(node) ? node.nodeId : node.ownerNodeId
  throw new Error(`DOCX node owner not found: ${id}`)
}

const partNameForNode = (index: NodeIndex, id: string): string => {
  const node = index.nodesById.get(id)
  if (node) return node.partName
  throw new Error(`DOCX node part not found: ${id}`)
}

const changedNode = (
  index: NodeIndex,
  nodeId: string,
  action: DocxChangedNode['action'] = 'format'
): DocxChangedNode => {
  const text = extractNodeText(index, nodeId)
  return { action, nodeId, beforeText: text, afterText: text }
}

const createPlainParagraph = (doc: Document, text: string): Element => {
  const paragraph = wordElement(doc, 'p')
  const run = wordElement(doc, 'r')
  const textNode = wordElement(doc, 't')
  setText(textNode, text)
  run.appendChild(textNode)
  paragraph.appendChild(run)
  return paragraph
}

const createPlainCell = (doc: Document, text: string): Element => {
  const cell = wordElement(doc, 'tc')
  cell.appendChild(createPlainParagraph(doc, text))
  return cell
}

const createPlainRow = (doc: Document, cells: readonly string[]): Element => {
  const row = wordElement(doc, 'tr')
  cells.forEach((text) => row.appendChild(createPlainCell(doc, text)))
  return row
}

const ensureChild = (parent: Element, name: string): Element => {
  const existing = firstChildElement(parent, name)
  if (existing) return existing
  const child = wordElement(parent.ownerDocument, name)
  parent.appendChild(child)
  return child
}

const applyMoveNode = async (
  buffer: Buffer,
  op: Extract<DocxOperation, { type: 'move_node' }>
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  const movingEntry = index.nodesById.get(op.nodeId)
  const anchorEntry = index.nodesById.get(op.anchorNodeId)
  const movingVisual = movingEntry && isVisualNode(movingEntry) ? movingEntry : undefined
  const anchorVisual = anchorEntry && isVisualNode(anchorEntry) ? anchorEntry : undefined
  const moving = movingVisual
    ? removableVisualNode(movingVisual.node)
    : editableElement(index, op.nodeId)
  const anchor = anchorVisual
    ? removableVisualNode(anchorVisual.node)
    : editableElement(index, op.anchorNodeId)
  if (!movingEntry || !anchorEntry) throw new Error('move node identity is missing')
  if (movingEntry.partName !== anchorEntry.partName) {
    throw new Error(
      'cross-story move is not supported because relationships cannot be preserved safely'
    )
  }
  if (moving === anchor && (op.position === 'before' || op.position === 'after'))
    return { buffer, changedNodes: [] }
  let anchorAncestor: Node | null = anchor
  while (anchorAncestor) {
    if (anchorAncestor === moving) throw new Error('cannot move a node into itself')
    anchorAncestor = anchorAncestor.parentNode
  }
  const sourceOwner = ownerNodeId(index, op.nodeId)
  const targetOwner = ownerNodeId(index, op.anchorNodeId)
  if (op.position === 'before' || op.position === 'after') {
    if (movingVisual && anchor.localName === 'p') {
      anchor.insertBefore(
        moving,
        op.position === 'before' ? firstChildElement(anchor, 'r') || null : null
      )
      return {
        buffer: await writeDocumentXml(bundle),
        changedNodes: [...new Set([sourceOwner, targetOwner])].map((id) =>
          changedNode(index, id, 'replace_node')
        )
      }
    }
    const parent = anchor.parentNode
    if (!parent || parent.nodeType !== 1) throw new Error('move anchor has no element parent')
    assertCompatibleInsertion(parent as Element, moving)
    const next = op.position === 'before' ? anchor : anchor.nextSibling
    if (next === moving || (moving.parentNode === parent && moving.nextSibling === next))
      return { buffer, changedNodes: [] }
    parent.insertBefore(moving, next)
  } else {
    const container = anchor.localName === 'sdt' ? firstChildElement(anchor, 'sdtContent') : anchor
    if (
      !container ||
      !['p', 'tc', 'sdtContent', 'txbxContent', 'body'].includes(container.localName)
    ) {
      throw new Error(`node ${op.anchorNodeId} cannot contain child content`)
    }
    if (container.localName === 'p' && !movingVisual) {
      throw new Error(`only visual nodes can move directly inside paragraph ${op.anchorNodeId}`)
    }
    assertCompatibleInsertion(container, moving)
    const next = op.position === 'inside_start' ? container.firstChild : null
    if (next === moving || (moving.parentNode === container && moving.nextSibling === next)) {
      return { buffer, changedNodes: [] }
    }
    container.insertBefore(moving, next)
  }
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: [...new Set([sourceOwner, targetOwner])].map((id) =>
      changedNode(index, id, 'replace_node')
    )
  }
}

type ContentDomainOp = Extract<
  DocxOperation,
  {
    type: 'replace_text' | 'insert_nodes' | 'replace_node' | 'delete_node'
  }
>

type ContentDraft =
  | Extract<ContentDomainOp, { type: 'insert_nodes' }>['nodes'][number]
  | Extract<ContentDomainOp, { type: 'replace_node' }>['node']

const contentDraftElement = (
  doc: Document,
  draft: ContentDraft,
  relationships: Awaited<ReturnType<typeof createRelationshipWriter>>
): Element => {
  if (draft.type === 'paragraph') {
    return createParagraphFromNode(
      doc,
      {
        type: 'paragraph',
        ...(draft.style ? { style: draft.style } : {}),
        children: [
          {
            type: 'run',
            ...(draft.runStyle ? { style: draft.runStyle } : {}),
            children: [{ type: 'text', text: draft.text }]
          }
        ]
      },
      relationships
    )
  }
  if (draft.type === 'run') {
    const paragraph = createParagraphFromNode(
      doc,
      {
        type: 'paragraph',
        children: [
          {
            type: 'run',
            ...(draft.style ? { style: draft.style } : {}),
            children: [{ type: 'text', text: draft.text }]
          }
        ]
      },
      relationships
    )
    return firstChildElement(paragraph, 'r')!
  }
  if (draft.type === 'hyperlink') {
    const paragraph = createParagraphFromNode(
      doc,
      {
        type: 'paragraph',
        children: [
          {
            type: 'hyperlink',
            target: draft.target,
            children: [
              {
                type: 'run',
                ...(draft.style ? { style: draft.style } : {}),
                children: [{ type: 'text', text: draft.text }]
              }
            ]
          }
        ]
      },
      relationships
    )
    return firstChildElement(paragraph, 'hyperlink')!
  }
  if (draft.type === 'field') {
    const field = wordElement(doc, 'fldSimple')
    setWordAttr(field, 'instr', draft.instruction)
    const run = wordElement(doc, 'r')
    const text = wordElement(doc, 't')
    setText(text, draft.displayText || '')
    run.appendChild(text)
    field.appendChild(run)
    return field
  }
  if (draft.type === 'visual') {
    throw new Error('visual drafts must be compiled to media operations before OOXML execution')
  }
  const run = wordElement(doc, 'r')
  const br = wordElement(doc, 'br')
  if (draft.kind !== 'line') setWordAttr(br, 'type', draft.kind)
  run.appendChild(br)
  return run
}

const isNodeElement = (node: Element): boolean => node.localName === 'p' || node.localName === 'tbl'

const assertCompatibleInsertion = (parent: Element, node: Element): void => {
  const containerParent = [
    'body',
    'hdr',
    'ftr',
    'footnote',
    'endnote',
    'tc',
    'sdtContent',
    'txbxContent',
    'ins',
    'del',
    'moveFrom',
    'moveTo'
  ].includes(parent.localName)
  if (containerParent && !isNodeElement(node)) {
    throw new Error(`${node.localName} cannot be inserted directly inside ${parent.localName}`)
  }
  if (parent.localName === 'p' && isNodeElement(node)) {
    throw new Error(`${node.localName} cannot be inserted inside a paragraph`)
  }
  if (!containerParent && parent.localName !== 'p' && parent.localName !== 'hyperlink') {
    throw new Error(`${parent.localName} is not an editable content container`)
  }
}

const applyContentDomainOp = async (
  buffer: Buffer,
  op: ContentDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  if (
    op.type === 'replace_node' &&
    (op.node.type === 'visual' || index.nodesById.get(op.nodeId)?.category === 'visual')
  ) {
    return await applyVisualNodeReplacement(bundle, index, op)
  }
  if (op.type === 'replace_text') {
    const target = editableElement(index, op.nodeId)
    const owner = ownerNodeId(index, op.nodeId)
    const beforeText = extractNodeText(index, owner)
    let changed = false
    if (target.localName === 'r') {
      const segment = descendantElements(target, 't')
      if (segment.length > 0) changed = replaceInSegment(segment, op.oldText, op.newText)
    } else {
      directParagraphs(target).forEach((paragraph) => {
        textSegments(paragraph).forEach((segment) => {
          if (replaceInSegment(segment, op.oldText, op.newText)) changed = true
        })
      })
    }
    if (!changed) throw new Error(`replace_text not found in node: ${op.oldText}`)
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [
        { action: 'replace_text', nodeId: owner, beforeText, afterText: target.textContent || '' }
      ]
    }
  }

  if (op.type === 'insert_nodes') {
    let owner: string
    let targetDocument = bundle.documentDom
    let partName = 'word/document.xml'
    let anchor: Element | undefined
    if (op.position === 'document_end') {
      const body = bundle.documentDom.getElementsByTagNameNS(WORD_NS, 'body').item(0)
      if (!body) throw new Error('DOCX body is missing')
      const relationships = await createRelationshipWriter(bundle.zip, partName)
      const created = op.nodes.map((draft) =>
        contentDraftElement(targetDocument, draft, relationships)
      )
      created.forEach((node) => {
        assertCompatibleInsertion(body, node)
        body.insertBefore(node, firstChildElement(body, 'sectPr') || null)
      })
      await relationships.persist()
      owner = index.rootNodeIds.at(-1) || ''
    } else {
      if (!op.nodeId) throw new Error(`${op.position} requires nodeId`)
      anchor = editableElement(index, op.nodeId)
      targetDocument = anchor.ownerDocument
      partName = partNameForNode(index, op.nodeId)
      const relationships = await createRelationshipWriter(bundle.zip, partName)
      const created = op.nodes.map((draft) =>
        contentDraftElement(targetDocument, draft, relationships)
      )
      owner = ownerNodeId(index, op.nodeId)
      if (op.position === 'inside_start' || op.position === 'inside_end') {
        let container =
          anchor.localName === 'sdt' ? firstChildElement(anchor, 'sdtContent') : anchor
        if (!container && anchor.localName === 'sdt') {
          container = wordElement(anchor.ownerDocument, 'sdtContent')
          anchor.appendChild(container)
        }
        if (!container) throw new Error('content control has no sdtContent')
        created.forEach((node) => assertCompatibleInsertion(container, node))
        const reference =
          op.position === 'inside_start'
            ? firstChildElement(container, container.localName === 'p' ? 'r' : 'p') ||
              container.firstChild
            : null
        created.forEach((node) => container.insertBefore(node, reference))
      } else {
        const parent = anchor.parentNode
        if (!parent || parent.nodeType !== 1)
          throw new Error('content anchor has no element parent')
        created.forEach((node) => assertCompatibleInsertion(parent as Element, node))
        const reference = op.position === 'before' ? anchor : anchor.nextSibling
        created.forEach((node) => parent.insertBefore(node, reference))
      }
      await relationships.persist()
    }
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: owner ? [changedNode(index, owner, 'insert_nodes')] : []
    }
  }

  const target = editableElement(index, op.nodeId)
  const owner = ownerNodeId(index, op.nodeId)
  const relationships = await createRelationshipWriter(
    bundle.zip,
    partNameForNode(index, op.nodeId)
  )
  const partName = partNameForNode(index, op.nodeId)
  const removedRelationshipIds = collectRelationshipIds(target)
  if (op.type === 'delete_node') {
    const deletesRoot = index.nodesById.has(op.nodeId)
    target.parentNode?.removeChild(target)
    await relationships.persist()
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, owner, deletesRoot ? 'delete_node' : 'replace_node')]
    }
  } else {
    const replacement = contentDraftElement(target.ownerDocument, op.node, relationships)
    const parent = target.parentNode
    if (!parent || parent.nodeType !== 1)
      throw new Error('replacement target has no element parent')
    assertCompatibleInsertion(parent as Element, replacement)
    if (target.localName === replacement.localName) {
      const propertyName = target.localName === 'p' ? 'pPr' : target.localName === 'r' ? 'rPr' : ''
      if (propertyName && !firstChildElement(replacement, propertyName)) {
        const properties = firstChildElement(target, propertyName)
        if (properties) replacement.insertBefore(properties.cloneNode(true), replacement.firstChild)
      }
    }
    parent.replaceChild(replacement, target)
  }
  await relationships.persist()
  for (const relationshipId of removedRelationshipIds) {
    await removeUnusedRelationship(bundle, partName, relationshipId)
  }
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: [changedNode(index, owner, 'replace_node')]
  }
}

type TableDomainOp = Extract<
  DocxOperation,
  {
    type:
      | 'insert_row'
      | 'create_table'
      | 'delete_table'
      | 'delete_row'
      | 'insert_column'
      | 'delete_column'
      | 'merge_cells'
      | 'split_cell'
  }
>

const tableForOp = (index: NodeIndex, id: string): Element => {
  const node = editableElement(index, id)
  if (node.localName !== 'tbl') throw new Error(`target is not a table: ${id}`)
  return node
}

const applyTableDomainOp = async (
  buffer: Buffer,
  op: TableDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  if (op.type === 'create_table') {
    const table = wordElement(bundle.documentDom, 'tbl')
    op.rows.forEach((cells) => table.appendChild(createPlainRow(bundle.documentDom, cells)))
    if (op.position === 'document_end') {
      const body = bundle.documentDom.getElementsByTagNameNS(WORD_NS, 'body').item(0)
      if (!body) throw new Error('DOCX body is missing')
      body.insertBefore(table, firstChildElement(body, 'sectPr') || null)
      const owner = index.rootNodeIds.at(-1)
      return {
        buffer: await writeDocumentXml(bundle),
        changedNodes: owner ? [changedNode(index, owner, 'insert_nodes')] : []
      }
    }
    if (!op.nodeId) throw new Error(`${op.position} requires nodeId`)
    const anchor = editableElement(index, op.nodeId)
    const parent = anchor.parentNode
    if (!parent) throw new Error('table anchor has no parent')
    parent.insertBefore(table, op.position === 'before' ? anchor : anchor.nextSibling)
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, ownerNodeId(index, op.nodeId), 'insert_nodes')]
    }
  }
  if (op.type === 'delete_table') {
    const table = editableElement(index, op.tableNodeId)
    if (table.localName !== 'tbl') throw new Error('delete_table target is not a table')
    table.parentNode?.removeChild(table)
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, ownerNodeId(index, op.tableNodeId), 'delete_node')]
    }
  }
  let table: Element
  if (op.type === 'delete_row') {
    const row = editableElement(index, op.rowNodeId)
    if (row.localName !== 'tr') throw new Error('delete_row target is not a row')
    table = row.parentNode as Element
    if (childElements(table, 'tr').length <= 1) throw new Error('cannot delete the last table row')
    table.removeChild(row)
  } else if (op.type === 'split_cell') {
    const cell = editableElement(index, op.cellNodeId)
    if (cell.localName !== 'tc') throw new Error('split_cell target is not a cell')
    const row = cell.parentNode as Element
    table = row.parentNode as Element
    const originalCells = childElements(row, 'tc')
    const targetColumn = originalCells.indexOf(cell)
    if (targetColumn < 0) throw new Error('split_cell target is detached from its row')
    const reference = cell.nextSibling
    for (let column = 1; column < op.columns; column += 1) {
      row.insertBefore(createPlainCell(bundle.documentDom, ''), reference)
    }
    const tcPr = firstChildElement(cell, 'tcPr')
    if (tcPr) {
      childElements(tcPr, 'gridSpan').forEach((node) => tcPr.removeChild(node))
      childElements(tcPr, 'vMerge').forEach((node) => tcPr.removeChild(node))
    }
    if (op.rows > 1) {
      const splitRowCells = childElements(row, 'tc')
      splitRowCells.forEach((rowCell, columnIndex) => {
        if (columnIndex >= targetColumn && columnIndex < targetColumn + op.columns) return
        setValProperty(ensureProperties(rowCell, 'tcPr'), 'vMerge', 'restart')
      })
      let insertBefore = row.nextSibling
      for (let rowOffset = 1; rowOffset < op.rows; rowOffset += 1) {
        const continuationRow = wordElement(bundle.documentDom, 'tr')
        splitRowCells.forEach((_, columnIndex) => {
          const continuationCell = createPlainCell(bundle.documentDom, '')
          if (columnIndex < targetColumn || columnIndex >= targetColumn + op.columns) {
            setValProperty(ensureProperties(continuationCell, 'tcPr'), 'vMerge', '')
          }
          continuationRow.appendChild(continuationCell)
        })
        table.insertBefore(continuationRow, insertBefore)
        insertBefore = continuationRow.nextSibling
      }
    }
  } else {
    table = tableForOp(index, op.tableNodeId)
    const rows = childElements(table, 'tr')
    if (op.type === 'insert_row') {
      const anchor = op.rowNodeId ? editableElement(index, op.rowNodeId) : rows.at(-1)
      if (!anchor || anchor.localName !== 'tr') throw new Error('insert_row anchor not found')
      const next = op.position === 'before' ? anchor : anchor.nextSibling
      table.insertBefore(createPlainRow(bundle.documentDom, op.cells), next)
    } else if (op.type === 'insert_column') {
      if (op.cells && op.cells.length !== rows.length) {
        throw new Error(`insert_column cells must contain exactly ${String(rows.length)} values`)
      }
      const columnIndex = op.columnIndex - 1
      rows.forEach((row, rowIndex) => {
        const cells = childElements(row, 'tc')
        if (columnIndex > cells.length) throw new Error('insert_column index is out of range')
        row.insertBefore(
          createPlainCell(bundle.documentDom, op.cells?.[rowIndex] || ''),
          cells[columnIndex] || null
        )
      })
    } else if (op.type === 'delete_column') {
      const columnIndex = op.columnIndex - 1
      rows.forEach((row) => {
        const cells = childElements(row, 'tc')
        if (cells.length <= 1) throw new Error('cannot delete the last table column')
        const cell = cells[columnIndex]
        if (!cell) throw new Error('delete_column index is out of range')
        row.removeChild(cell)
      })
    } else {
      const fromRow = Math.min(op.fromRow, op.toRow) - 1
      const toRow = Math.max(op.fromRow, op.toRow) - 1
      const fromColumn = Math.min(op.fromColumn, op.toColumn) - 1
      const toColumn = Math.max(op.fromColumn, op.toColumn) - 1
      if (toRow >= rows.length) throw new Error('merge_cells row is out of range')
      for (let rowIndex = fromRow; rowIndex <= toRow; rowIndex += 1) {
        const cells = childElements(rows[rowIndex]!, 'tc')
        if (toColumn >= cells.length) throw new Error('merge_cells column is out of range')
        const keeper = cells[fromColumn]!
        const removedCells = cells.slice(fromColumn + 1, toColumn + 1)
        const properties = ensureProperties(keeper, 'tcPr')
        if (toColumn > fromColumn) setValProperty(properties, 'gridSpan', toColumn - fromColumn + 1)
        if (toRow > fromRow)
          setValProperty(properties, 'vMerge', rowIndex === fromRow ? 'restart' : '')
        removedCells.forEach((cell) => rows[rowIndex]!.removeChild(cell))
      }
    }
  }
  const tableId = [...index.nodesById.values()].find(
    (candidate) => candidate.node === table
  )?.nodeId
  if (!tableId) throw new Error('table owner not found')
  if (op.type === 'delete_row') {
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, op.rowNodeId, 'delete_node')]
    }
  }
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: [changedNode(index, tableId, 'table_update')]
  }
}

type FormatDomainOp = Extract<
  DocxOperation,
  {
    type:
      | 'format_section'
      | 'reset_format'
      | 'create_named_style'
      | 'update_named_style'
      | 'delete_named_style'
      | 'set_numbering'
  }
>

const stylesDocument = async (zip: JSZip): Promise<Document> => {
  const xml = await zip.file('word/styles.xml')?.async('text')
  if (xml) return new DOMParser().parseFromString(xml, 'application/xml')
  return new DOMParser().parseFromString(`<w:styles xmlns:w="${WORD_NS}"/>`, 'application/xml')
}

const styleById = (doc: Document, styleId: string): Element | undefined =>
  childElements(doc.documentElement, 'style').find((style) => getAttr(style, 'styleId') === styleId)

const numberingId = (nodes: Element[], attribute: string): number =>
  Math.max(-1, ...nodes.map((node) => Number(getAttr(node, attribute))).filter(Number.isFinite)) + 1

const ensureNumberingDefinition = async (
  zip: JSZip,
  kind: 'bullet' | 'decimal'
): Promise<string> => {
  const numbering = await packageDocument(
    zip,
    'word/numbering.xml',
    `<w:numbering xmlns:w="${WORD_NS}"/>`
  )
  const abstractNumbers = childElements(numbering.documentElement, 'abstractNum')
  let abstractNumber = abstractNumbers.find((candidate) =>
    descendantElements(candidate, 'numFmt').some((format) => getAttr(format, 'val') === kind)
  )
  if (!abstractNumber) {
    abstractNumber = wordElement(numbering, 'abstractNum')
    const abstractId = String(numberingId(abstractNumbers, 'abstractNumId'))
    setWordAttr(abstractNumber, 'abstractNumId', abstractId)
    for (let levelIndex = 0; levelIndex < 9; levelIndex += 1) {
      const level = wordElement(numbering, 'lvl')
      setWordAttr(level, 'ilvl', String(levelIndex))
      setValProperty(level, 'start', '1')
      setValProperty(level, 'numFmt', kind)
      setValProperty(level, 'lvlText', kind === 'bullet' ? '•' : `%${String(levelIndex + 1)}.`)
      setValProperty(level, 'lvlJc', 'left')
      abstractNumber.appendChild(level)
    }
    numbering.documentElement.appendChild(abstractNumber)
  }
  const abstractId = getAttr(abstractNumber, 'abstractNumId')
  const numbers = childElements(numbering.documentElement, 'num')
  let number = numbers.find(
    (candidate) =>
      getAttr(firstChildElement(candidate, 'abstractNumId') || candidate, 'val') === abstractId
  )
  if (!number) {
    number = wordElement(numbering, 'num')
    setWordAttr(number, 'numId', String(numberingId(numbers, 'numId')))
    setValProperty(number, 'abstractNumId', abstractId)
    numbering.documentElement.appendChild(number)
  }
  zip.file('word/numbering.xml', new XMLSerializer().serializeToString(numbering))
  await ensureDocumentRelationship(zip, NUMBERING_REL_TYPE, 'numbering.xml')
  await ensureContentTypeOverride(
    zip,
    '/word/numbering.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml'
  )
  return getAttr(number, 'numId')
}

const patchNamedStyle = (
  style: Element,
  patch: Extract<FormatDomainOp, { type: 'create_named_style' | 'update_named_style' }>
): void => {
  if (patch.name) setValProperty(style, 'name', patch.name)
  if (patch.type === 'create_named_style' && patch.basedOnStyleId) {
    setValProperty(style, 'basedOn', patch.basedOnStyleId)
  }
  if (patch.paragraph) patchParagraphProperties(style, { kind: 'paragraph', ...patch.paragraph })
  if (patch.run) patchRunProperties(style, { kind: 'run', ...patch.run })
}

const ensureSectionProperties = (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  target: Element
): Element => {
  const body = bundle.documentDom.getElementsByTagNameNS(WORD_NS, 'body').item(0)
  if (!body) throw new Error('DOCX body is missing')
  let root: Element = target
  while (root.parentNode && root.parentNode !== body) root = root.parentNode as Element
  const bodyContent = childElements(body).filter((node) => node.localName !== 'sectPr')
  const targetIndex = bodyContent.indexOf(root)
  const sectionParagraph =
    targetIndex >= 0
      ? bodyContent
          .slice(targetIndex)
          .find(
            (node) =>
              node.localName === 'p' &&
              Boolean(firstChildElement(firstChildElement(node, 'pPr') || node, 'sectPr'))
          )
      : undefined
  const paragraphSection = sectionParagraph
    ? firstChildElement(firstChildElement(sectionParagraph, 'pPr')!, 'sectPr')
    : undefined
  if (paragraphSection) return paragraphSection
  const existing = childElements(body, 'sectPr').at(-1)
  if (existing) return existing
  const section = wordElement(bundle.documentDom, 'sectPr')
  body.appendChild(section)
  return section
}

const applyFormatDomainOp = async (
  buffer: Buffer,
  op: FormatDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  if (op.type === 'reset_format') {
    const target = editableElement(index, op.nodeId)
    const propertyName: Record<string, string> = {
      r: 'rPr',
      p: 'pPr',
      tbl: 'tblPr',
      tr: 'trPr',
      tc: 'tcPr'
    }
    const name = propertyName[target.localName]
    if (!name) throw new Error(`reset_format does not support ${target.localName}`)
    const properties = firstChildElement(target, name)
    if (properties) {
      const preserved = new Set(name === 'pPr' ? ['pStyle', 'numPr', 'sectPr'] : [])
      childElements(properties).forEach((child) => {
        if (!preserved.has(child.localName)) properties.removeChild(child)
      })
    }
    const owner = ownerNodeId(index, op.nodeId)
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, owner)]
    }
  }
  if (op.type === 'format_section') {
    const targetEntry = index.nodesById.get(op.nodeId)
    if (!targetEntry || targetEntry.story.type !== 'body') {
      throw new Error('format_section target must be in the document body')
    }
    const section = ensureSectionProperties(bundle, targetEntry.node)
    if (op.orientation) {
      const size = ensureChild(section, 'pgSz')
      const currentWidth = getAttr(size, 'w') || '11906'
      const currentHeight = getAttr(size, 'h') || '16838'
      setWordAttr(size, 'orient', op.orientation)
      setWordAttr(size, 'w', op.orientation === 'landscape' ? currentHeight : currentWidth)
      setWordAttr(size, 'h', op.orientation === 'landscape' ? currentWidth : currentHeight)
    }
    const marginValues = [
      ['top', op.marginTopPt],
      ['right', op.marginRightPt],
      ['bottom', op.marginBottomPt],
      ['left', op.marginLeftPt]
    ] as const
    if (marginValues.some(([, value]) => value !== undefined)) {
      const margins = ensureChild(section, 'pgMar')
      marginValues.forEach(([name, value]) => {
        if (value !== undefined) setWordAttr(margins, name, String(ptToTwips(value)))
      })
    }
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: index.rootNodeIds.map((id) => changedNode(index, id))
    }
  }
  if (op.type === 'set_numbering') {
    const paragraph = editableElement(index, op.nodeId)
    if (paragraph.localName !== 'p') throw new Error('set_numbering target is not a paragraph')
    const pPr = ensureProperties(paragraph, 'pPr')
    removeProperty(pPr, 'numPr')
    if (op.kind !== 'none') {
      const resolvedNumberId = await ensureNumberingDefinition(bundle.zip, op.kind)
      const numPr = wordElement(bundle.documentDom, 'numPr')
      const level = wordElement(bundle.documentDom, 'ilvl')
      setWordAttr(level, 'val', String(op.level || 0))
      const numId = wordElement(bundle.documentDom, 'numId')
      setWordAttr(numId, 'val', resolvedNumberId)
      numPr.appendChild(level)
      numPr.appendChild(numId)
      pPr.appendChild(numPr)
    }
    const owner = ownerNodeId(index, op.nodeId)
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, owner)]
    }
  }

  const styles = await stylesDocument(bundle.zip)
  if (op.type === 'create_named_style') {
    if (styleById(styles, op.styleId)) throw new Error(`named style already exists: ${op.styleId}`)
    const style = wordElement(styles, 'style')
    setWordAttr(style, 'type', 'paragraph')
    setWordAttr(style, 'styleId', op.styleId)
    patchNamedStyle(style, op)
    styles.documentElement.appendChild(style)
  } else if (op.type === 'update_named_style') {
    const style = styleById(styles, op.styleId)
    if (!style) throw new Error(`named style not found: ${op.styleId}`)
    patchNamedStyle(style, op)
  } else {
    const style = styleById(styles, op.styleId)
    if (!style) throw new Error(`named style not found: ${op.styleId}`)
    const references = storyDocuments(bundle).flatMap((document) =>
      descendantElements(document.documentElement, 'pStyle').filter(
        (node) => getAttr(node, 'val') === op.styleId
      )
    )
    if (references.length > 0 && !op.replacementStyleId) {
      throw new Error('named style is still in use; provide replacementStyleId')
    }
    references.forEach((node) => setWordAttr(node, 'val', op.replacementStyleId!))
    styles.documentElement.removeChild(style)
  }
  bundle.zip.file('word/styles.xml', new XMLSerializer().serializeToString(styles))
  await ensureDocumentRelationship(bundle.zip, STYLES_REL_TYPE, 'styles.xml')
  await ensureContentTypeOverride(
    bundle.zip,
    '/word/styles.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml'
  )
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: index.rootNodeIds.map((id) => changedNode(index, id))
  }
}

type RevisionDomainOp = Extract<
  DocxOperation,
  {
    type:
      | 'enable_track_changes'
      | 'disable_track_changes'
      | 'accept_revision'
      | 'reject_revision'
      | 'accept_all_revisions'
      | 'reject_all_revisions'
  }
>

const unwrapElement = (node: Element): void => {
  const parent = node.parentNode
  if (!parent) return
  while (node.firstChild) parent.insertBefore(node.firstChild, node)
  parent.removeChild(node)
}

const applyRevisionDomainOp = async (
  buffer: Buffer,
  op: RevisionDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  if (op.type === 'enable_track_changes' || op.type === 'disable_track_changes') {
    const existingXml = await bundle.zip.file('word/settings.xml')?.async('text')
    const settings = existingXml
      ? new DOMParser().parseFromString(existingXml, 'application/xml')
      : new DOMParser().parseFromString(`<w:settings xmlns:w="${WORD_NS}"/>`, 'application/xml')
    childElements(settings.documentElement, 'trackRevisions').forEach((node) =>
      settings.documentElement.removeChild(node)
    )
    if (op.type === 'enable_track_changes') {
      settings.documentElement.appendChild(wordElement(settings, 'trackRevisions'))
    }
    bundle.zip.file('word/settings.xml', new XMLSerializer().serializeToString(settings))
    await ensureDocumentRelationship(bundle.zip, SETTINGS_REL_TYPE, 'settings.xml')
    await ensureContentTypeOverride(
      bundle.zip,
      '/word/settings.xml',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'
    )
    const anchor = index.rootNodeIds.at(0)
    return {
      buffer: await writeZip(bundle.zip),
      changedNodes: anchor ? [changedNode(index, anchor)] : []
    }
  }

  const accepting = op.type === 'accept_revision' || op.type === 'accept_all_revisions'
  const revisionId =
    op.type === 'accept_revision' || op.type === 'reject_revision' ? op.revisionId : undefined
  const candidates = storyDocuments(bundle).flatMap((document) =>
    ['ins', 'del', 'moveFrom', 'moveTo'].flatMap((name) =>
      descendantElements(document.documentElement, name)
    )
  )
  let matched = 0
  candidates.forEach((node) => {
    if (revisionId && getAttr(node, 'id') !== revisionId) return
    matched += 1
    const insertion = node.localName === 'ins' || node.localName === 'moveTo'
    if ((accepting && insertion) || (!accepting && !insertion)) unwrapElement(node)
    else node.parentNode?.removeChild(node)
  })
  if (revisionId && matched === 0) throw new Error(`revision not found: ${revisionId}`)
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: index.rootNodeIds.map((id) => changedNode(index, id, 'replace_node'))
  }
}

type MediaDomainOp = Extract<
  DocxOperation,
  { type: 'insert_image' | 'replace_image' | 'delete_media' | 'update_image' }
>

const imageContentTypes: Readonly<Record<string, string>> = {
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  tif: 'image/tiff',
  tiff: 'image/tiff'
}

const readImage = async (
  imagePath: string
): Promise<{ bytes: Buffer; extension: string; contentType: string }> => {
  if (!path.isAbsolute(imagePath)) throw new Error('imagePath must be an absolute path')
  const extension = path.extname(imagePath).slice(1).toLowerCase()
  const contentType = imageContentTypes[extension]
  if (!contentType) throw new Error(`unsupported image type: ${extension || '(missing extension)'}`)
  return { bytes: await fs.readFile(imagePath), extension, contentType }
}

const packageDocument = async (
  zip: JSZip,
  fileName: string,
  fallbackXml: string
): Promise<Document> => {
  const xml = await zip.file(fileName)?.async('text')
  return new DOMParser().parseFromString(xml || fallbackXml, 'application/xml')
}

const ensureImageContentType = async (
  zip: JSZip,
  extension: string,
  contentType: string
): Promise<void> => {
  const contentTypes = await packageDocument(
    zip,
    '[Content_Types].xml',
    `<Types xmlns="${CONTENT_TYPES_NS}"/>`
  )
  const existing = childElements(contentTypes.documentElement, 'Default').find(
    (node) => node.getAttribute('Extension')?.toLowerCase() === extension
  )
  if (existing) existing.setAttribute('ContentType', contentType)
  else {
    const item = contentTypes.createElementNS(CONTENT_TYPES_NS, 'Default')
    item.setAttribute('Extension', extension)
    item.setAttribute('ContentType', contentType)
    contentTypes.documentElement.appendChild(item)
  }
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(contentTypes))
}

const ensureContentTypeOverride = async (
  zip: JSZip,
  partName: string,
  contentType: string
): Promise<void> => {
  const contentTypes = await packageDocument(
    zip,
    '[Content_Types].xml',
    `<Types xmlns="${CONTENT_TYPES_NS}"/>`
  )
  const existing = childElements(contentTypes.documentElement, 'Override').find(
    (node) => node.getAttribute('PartName') === partName
  )
  if (existing) existing.setAttribute('ContentType', contentType)
  else {
    const item = contentTypes.createElementNS(CONTENT_TYPES_NS, 'Override')
    item.setAttribute('PartName', partName)
    item.setAttribute('ContentType', contentType)
    contentTypes.documentElement.appendChild(item)
  }
  zip.file('[Content_Types].xml', new XMLSerializer().serializeToString(contentTypes))
}

const documentRelationships = async (zip: JSZip): Promise<Document> =>
  await packageDocument(
    zip,
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PACKAGE_REL_NS}"/>`
  )

const relationshipPartName = (partName: string): string =>
  path.posix.join(path.posix.dirname(partName), '_rels', `${path.posix.basename(partName)}.rels`)

const partRelationships = async (zip: JSZip, partName: string): Promise<Document> =>
  await packageDocument(
    zip,
    relationshipPartName(partName),
    `<Relationships xmlns="${PACKAGE_REL_NS}"/>`
  )

const persistPartRelationships = (zip: JSZip, partName: string, relationships: Document): void => {
  zip.file(relationshipPartName(partName), new XMLSerializer().serializeToString(relationships))
}

const sourcePartForRelationshipPart = (relationshipPart: string): string | undefined => {
  const normalized = relationshipPart.replace(/\\/g, '/')
  const marker = '/_rels/'
  const markerIndex = normalized.lastIndexOf(marker)
  if (markerIndex < 0 || !normalized.endsWith('.rels')) return undefined
  return `${normalized.slice(0, markerIndex)}/${normalized
    .slice(markerIndex + marker.length)
    .slice(0, -'.rels'.length)}`
}

const isMediaTargetReferenced = async (zip: JSZip, mediaPath: string): Promise<boolean> => {
  const relationshipParts = Object.keys(zip.files).filter(
    (name) => name.endsWith('.rels') && !zip.files[name]?.dir
  )
  for (const relationshipPart of relationshipParts) {
    const sourcePart = sourcePartForRelationshipPart(relationshipPart)
    if (!sourcePart) continue
    const xml = await zip.file(relationshipPart)?.async('text')
    if (!xml) continue
    const relationships = new DOMParser().parseFromString(xml, 'application/xml')
    const referencesTarget = childElements(relationships.documentElement, 'Relationship').some(
      (relation) =>
        relation.getAttribute('TargetMode') !== 'External' &&
        resolveDocxRelationshipTarget(relation.getAttribute('Target') || '', sourcePart) ===
          mediaPath
    )
    if (referencesTarget) return true
  }
  return false
}

const removeOrphanedMedia = async (
  zip: JSZip,
  sourcePart: string,
  relationship: Element
): Promise<void> => {
  if (
    relationship.getAttribute('Type') !== IMAGE_REL_TYPE ||
    relationship.getAttribute('TargetMode') === 'External'
  ) {
    return
  }
  const mediaPath = resolveDocxRelationshipTarget(
    relationship.getAttribute('Target') || '',
    sourcePart
  )
  if (!mediaPath || !mediaPath.startsWith('word/media/')) return
  if (!(await isMediaTargetReferenced(zip, mediaPath))) zip.remove(mediaPath)
}

const cleanupUnusedImageRelationships = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>
): Promise<void> => {
  const parts = [
    { partName: 'word/document.xml', dom: bundle.documentDom },
    ...bundle.stories.map((story) => ({ partName: story.partName, dom: story.dom }))
  ]
  for (const part of parts) {
    const relationshipPath = relationshipPartName(part.partName)
    if (!bundle.zip.file(relationshipPath)) continue
    const relationships = await partRelationships(bundle.zip, part.partName)
    const removed: Element[] = []
    for (const relation of childElements(relationships.documentElement, 'Relationship')) {
      const relationshipId = relation.getAttribute('Id') || ''
      if (
        relation.getAttribute('Type') === IMAGE_REL_TYPE &&
        relationshipId &&
        !isRelationshipReferenced(part.dom.documentElement, relationshipId)
      ) {
        removed.push(relation.cloneNode(true) as Element)
        relationships.documentElement.removeChild(relation)
      }
    }
    if (removed.length === 0) continue
    persistPartRelationships(bundle.zip, part.partName, relationships)
    for (const relation of removed) {
      await removeOrphanedMedia(bundle.zip, part.partName, relation)
    }
  }
}

const nextRelationshipId = (relationships: Document): string => {
  const used = new Set(
    childElements(relationships.documentElement, 'Relationship').map(
      (node) => node.getAttribute('Id') || ''
    )
  )
  let index = 1
  while (used.has(`rId${index}`)) index += 1
  return `rId${index}`
}

const nextImageTarget = (zip: JSZip, extension: string): string => {
  const used = new Set(Object.keys(zip.files))
  let index = 1
  while (used.has(`word/media/ncurator-${index}.${extension}`)) index += 1
  return `media/ncurator-${index}.${extension}`
}

const appendRelationship = (
  relationships: Document,
  relationshipId: string,
  target: string,
  type: string
): void => {
  const relationship = relationships.createElementNS(PACKAGE_REL_NS, 'Relationship')
  relationship.setAttribute('Id', relationshipId)
  relationship.setAttribute('Type', type)
  relationship.setAttribute('Target', target)
  relationships.documentElement.appendChild(relationship)
}

const ensureDocumentRelationship = async (
  zip: JSZip,
  type: string,
  target: string
): Promise<void> => {
  const relationships = await documentRelationships(zip)
  const exists = childElements(relationships.documentElement, 'Relationship').some(
    (node) => node.getAttribute('Type') === type
  )
  if (!exists) appendRelationship(relationships, nextRelationshipId(relationships), target, type)
  zip.file('word/_rels/document.xml.rels', new XMLSerializer().serializeToString(relationships))
}

const cmToEmu = (value: number): string => String(Math.round(value * 360000))

const drawingRun = (
  doc: Document,
  relationshipId: string,
  widthCm: number,
  heightCm: number,
  altText: string,
  drawingId: number
): Element => {
  const width = cmToEmu(widthCm)
  const height = cmToEmu(heightCm)
  const run = wordElement(doc, 'r')
  const drawing = wordElement(doc, 'drawing')
  const inline = namespacedElement(doc, WORDPROCESSING_DRAWING_NS, 'wp', 'inline')
  const extent = namespacedElement(doc, WORDPROCESSING_DRAWING_NS, 'wp', 'extent')
  extent.setAttribute('cx', width)
  extent.setAttribute('cy', height)
  const docProperties = namespacedElement(doc, WORDPROCESSING_DRAWING_NS, 'wp', 'docPr')
  docProperties.setAttribute('id', String(drawingId))
  docProperties.setAttribute('name', `NCurator image ${drawingId}`)
  docProperties.setAttribute('descr', altText)
  const graphic = namespacedElement(doc, DRAWING_NS, 'a', 'graphic')
  const graphicData = namespacedElement(doc, DRAWING_NS, 'a', 'graphicData')
  graphicData.setAttribute('uri', PICTURE_GRAPHIC_URI)
  const picture = namespacedElement(doc, PICTURE_NS, 'pic', 'pic')
  const nonVisual = namespacedElement(doc, PICTURE_NS, 'pic', 'nvPicPr')
  const pictureProperties = namespacedElement(doc, PICTURE_NS, 'pic', 'cNvPr')
  pictureProperties.setAttribute('id', String(drawingId))
  pictureProperties.setAttribute('name', `NCurator image ${drawingId}`)
  pictureProperties.setAttribute('descr', altText)
  nonVisual.appendChild(pictureProperties)
  nonVisual.appendChild(namespacedElement(doc, PICTURE_NS, 'pic', 'cNvPicPr'))
  const fill = namespacedElement(doc, PICTURE_NS, 'pic', 'blipFill')
  const blip = namespacedElement(doc, DRAWING_NS, 'a', 'blip')
  setRelAttr(blip, 'embed', relationshipId)
  const stretch = namespacedElement(doc, DRAWING_NS, 'a', 'stretch')
  stretch.appendChild(namespacedElement(doc, DRAWING_NS, 'a', 'fillRect'))
  fill.appendChild(blip)
  fill.appendChild(stretch)
  const shape = namespacedElement(doc, PICTURE_NS, 'pic', 'spPr')
  const transform = namespacedElement(doc, DRAWING_NS, 'a', 'xfrm')
  const offset = namespacedElement(doc, DRAWING_NS, 'a', 'off')
  offset.setAttribute('x', '0')
  offset.setAttribute('y', '0')
  const dimensions = namespacedElement(doc, DRAWING_NS, 'a', 'ext')
  dimensions.setAttribute('cx', width)
  dimensions.setAttribute('cy', height)
  transform.appendChild(offset)
  transform.appendChild(dimensions)
  const geometry = namespacedElement(doc, DRAWING_NS, 'a', 'prstGeom')
  geometry.setAttribute('prst', 'rect')
  geometry.appendChild(namespacedElement(doc, DRAWING_NS, 'a', 'avLst'))
  shape.appendChild(transform)
  shape.appendChild(geometry)
  picture.appendChild(nonVisual)
  picture.appendChild(fill)
  picture.appendChild(shape)
  graphicData.appendChild(picture)
  graphic.appendChild(graphicData)
  inline.appendChild(extent)
  inline.appendChild(docProperties)
  inline.appendChild(graphic)
  drawing.appendChild(inline)
  run.appendChild(drawing)
  return run
}

const visualElement = (
  index: NodeIndex,
  nodeId: string
): {
  descriptor: DocxVisualDescriptor
  node: Element
} => {
  const descriptor = index.nodesById.get(nodeId)
  if (!descriptor || !isVisualNode(descriptor)) throw new Error(`media not found: ${nodeId}`)
  return { descriptor, node: descriptor.node }
}

type VisualDraft = Extract<ContentDraft, { type: 'visual' }>

const createImageRunForPart = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  partName: string,
  targetDocument: Document,
  visual: VisualDraft
): Promise<Element> => {
  if (!visual.imagePath) throw new Error('Replacing a node with a visual requires imagePath')
  const image = await readImage(visual.imagePath)
  const relationships = await partRelationships(bundle.zip, partName)
  const relationshipId = nextRelationshipId(relationships)
  const target = nextImageTarget(bundle.zip, image.extension)
  appendRelationship(relationships, relationshipId, target, IMAGE_REL_TYPE)
  await ensureImageContentType(bundle.zip, image.extension, image.contentType)
  bundle.zip.file(path.posix.join('word', target), image.bytes)
  persistPartRelationships(bundle.zip, partName, relationships)
  const drawingIds = storyDocuments(bundle)
    .flatMap((document) => descendantElements(document.documentElement, 'docPr'))
    .map((node) => Number(node.getAttribute('id') || '0'))
    .filter(Number.isFinite)
  return drawingRun(
    targetDocument,
    relationshipId,
    visual.widthCm || 6,
    visual.heightCm || 4,
    visual.altText || '',
    Math.max(0, ...drawingIds) + 1
  )
}

const removableVisualNode = (node: Element): Element =>
  node.parentNode?.nodeType === 1 && (node.parentNode as Element).localName === 'r'
    ? (node.parentNode as Element)
    : node

const replaceExistingImageBytes = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  partName: string,
  relationshipId: string,
  imagePath: string
): Promise<void> => {
  const image = await readImage(imagePath)
  const relationships = await partRelationships(bundle.zip, partName)
  const relation = childElements(relationships.documentElement, 'Relationship').find(
    (node) => node.getAttribute('Id') === relationshipId
  )
  if (!relation) throw new Error(`image relationship not found: ${relationshipId}`)
  const previousRelation = relation.cloneNode(true) as Element
  const nextTarget = nextImageTarget(bundle.zip, image.extension)
  relation.setAttribute('Target', nextTarget)
  await ensureImageContentType(bundle.zip, image.extension, image.contentType)
  bundle.zip.file(path.posix.join('word', nextTarget), image.bytes)
  persistPartRelationships(bundle.zip, partName, relationships)
  await removeOrphanedMedia(bundle.zip, partName, previousRelation)
}

const applyVisualNodeReplacement = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  index: NodeIndex,
  op: Extract<ContentDomainOp, { type: 'replace_node' }>
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const existingNode = index.nodesById.get(op.nodeId)
  const existingVisual = existingNode && isVisualNode(existingNode) ? existingNode : undefined
  if (existingVisual) {
    const current = visualElement(index, op.nodeId)
    if (op.node.type === 'visual') {
      if (op.node.imagePath) {
        if (existingVisual.kind === 'image' && existingVisual.relationshipId) {
          await replaceExistingImageBytes(
            bundle,
            existingVisual.partName,
            existingVisual.relationshipId,
            op.node.imagePath
          )
        } else {
          const replacement = await createImageRunForPart(
            bundle,
            existingVisual.partName,
            current.node.ownerDocument,
            op.node
          )
          const removable = removableVisualNode(current.node)
          removable.parentNode?.replaceChild(replacement, removable)
          if (existingVisual.relationshipId) {
            await removeUnusedRelationship(
              bundle,
              existingVisual.partName,
              existingVisual.relationshipId
            )
          }
          return {
            buffer: await writeDocumentXml(bundle),
            changedNodes: [changedNode(index, existingVisual.ownerNodeId, 'replace_node')]
          }
        }
      }
      patchImageProperties(current.node, op.node.widthCm, op.node.heightCm, op.node.altText)
      return {
        buffer: await writeDocumentXml(bundle),
        changedNodes: [changedNode(index, existingVisual.ownerNodeId, 'replace_node')]
      }
    }

    const relationships = await createRelationshipWriter(bundle.zip, existingVisual.partName)
    const replacement = contentDraftElement(current.node.ownerDocument, op.node, relationships)
    const removable = removableVisualNode(current.node)
    const parent = removable.parentNode
    if (!parent || parent.nodeType !== 1) throw new Error('visual replacement target has no parent')
    if (replacement.localName === 'p' && (parent as Element).localName === 'p') {
      const paragraph = parent as Element
      const paragraphParent = paragraph.parentNode
      if (!paragraphParent) throw new Error('visual paragraph has no parent')
      paragraphParent.replaceChild(replacement, paragraph)
    } else {
      assertCompatibleInsertion(parent as Element, replacement)
      parent.replaceChild(replacement, removable)
    }
    await relationships.persist()
    if (existingVisual.relationshipId) {
      await removeUnusedRelationship(bundle, existingVisual.partName, existingVisual.relationshipId)
    }
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, existingVisual.ownerNodeId, 'replace_node')]
    }
  }

  if (op.node.type !== 'visual') throw new Error(`replacement target not found: ${op.nodeId}`)
  const target = editableElement(index, op.nodeId)
  const partName = partNameForNode(index, op.nodeId)
  const replacementRun = await createImageRunForPart(
    bundle,
    partName,
    target.ownerDocument,
    op.node
  )
  const parent = target.parentNode
  if (!parent || parent.nodeType !== 1) throw new Error('replacement target has no parent')
  if (target.localName === 'p') {
    const paragraph = wordElement(target.ownerDocument, 'p')
    const properties = firstChildElement(target, 'pPr')
    if (properties) paragraph.appendChild(properties.cloneNode(true))
    paragraph.appendChild(replacementRun)
    parent.replaceChild(paragraph, target)
  } else if ((parent as Element).localName === 'p') {
    parent.replaceChild(replacementRun, target)
  } else {
    throw new Error(`node ${op.nodeId} cannot be replaced by an inline visual`)
  }
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: [changedNode(index, ownerNodeId(index, op.nodeId), 'replace_node')]
  }
}

const patchImageProperties = (
  drawing: Element,
  widthCm: number | undefined,
  heightCm: number | undefined,
  altText: string | undefined
): void => {
  if (widthCm !== undefined || heightCm !== undefined) {
    descendantElements(drawing, 'extent').forEach((node) => {
      if (widthCm !== undefined) node.setAttribute('cx', cmToEmu(widthCm))
      if (heightCm !== undefined) node.setAttribute('cy', cmToEmu(heightCm))
    })
    descendantElements(drawing, 'ext').forEach((node) => {
      if (widthCm !== undefined) node.setAttribute('cx', cmToEmu(widthCm))
      if (heightCm !== undefined) node.setAttribute('cy', cmToEmu(heightCm))
    })
  }
  if (altText !== undefined) {
    descendantElements(drawing, 'docPr').forEach((node) => node.setAttribute('descr', altText))
    descendantElements(drawing, 'cNvPr').forEach((node) => node.setAttribute('descr', altText))
  }
}

const removeUnusedRelationship = async (
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  partName: string,
  relationshipId: string
): Promise<void> => {
  const partDocument = documentForPart(bundle, partName)
  if (isRelationshipReferenced(partDocument.documentElement, relationshipId)) return
  const relationships = await partRelationships(bundle.zip, partName)
  const relation = childElements(relationships.documentElement, 'Relationship').find(
    (node) => node.getAttribute('Id') === relationshipId
  )
  if (!relation) return
  const removedRelation = relation.cloneNode(true) as Element
  relationships.documentElement.removeChild(relation)
  persistPartRelationships(bundle.zip, partName, relationships)
  await removeOrphanedMedia(bundle.zip, partName, removedRelation)
}

const applyMediaDomainOp = async (
  buffer: Buffer,
  op: MediaDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  if (op.type === 'insert_image') {
    const image = await readImage(op.imagePath)
    const partName = op.nodeId ? partNameForNode(index, op.nodeId) : 'word/document.xml'
    const targetDocument = documentForPart(bundle, partName)
    const relationships = await partRelationships(bundle.zip, partName)
    const relationshipId = nextRelationshipId(relationships)
    const target = nextImageTarget(bundle.zip, image.extension)
    appendRelationship(relationships, relationshipId, target, IMAGE_REL_TYPE)
    await ensureImageContentType(bundle.zip, image.extension, image.contentType)
    bundle.zip.file(path.posix.join('word', target), image.bytes)
    persistPartRelationships(bundle.zip, partName, relationships)
    const anchor = op.nodeId
      ? editableElement(index, op.nodeId)
      : [...index.nodesById.values()]
          .filter((node) => node.kind === 'paragraph' && node.story.type === 'body')
          .at(-1)?.node
    if (!anchor) throw new Error('image insertion requires an existing paragraph or run anchor')
    const paragraph =
      anchor.localName === 'p'
        ? anchor
        : anchor.localName === 'r' && anchor.parentNode?.nodeType === 1
          ? (anchor.parentNode as Element)
          : undefined
    if (!paragraph || paragraph.localName !== 'p')
      throw new Error('image anchor must be a paragraph or run')
    const drawingIds = storyDocuments(bundle)
      .flatMap((document) => descendantElements(document.documentElement, 'docPr'))
      .map((node) => Number(node.getAttribute('id') || '0'))
      .filter(Number.isFinite)
    const run = drawingRun(
      targetDocument,
      relationshipId,
      op.widthCm || 6,
      op.heightCm || 4,
      op.altText || '',
      Math.max(0, ...drawingIds) + 1
    )
    if (anchor.localName === 'r') {
      paragraph.insertBefore(run, op.position === 'before' ? anchor : anchor.nextSibling)
    } else if (op.position === 'before')
      paragraph.insertBefore(run, firstChildElement(paragraph, 'r') || null)
    else paragraph.appendChild(run)
    const owner = ownerNodeId(
      index,
      op.nodeId ||
        [...index.nodesById.values()].find((node) => node.node === paragraph)?.nodeId ||
        ''
    )
    return {
      buffer: await writeDocumentXml(bundle),
      changedNodes: [changedNode(index, owner, 'replace_node')]
    }
  }

  const visual = visualElement(index, op.nodeId)
  const partName = visual.descriptor.partName
  if (op.type === 'replace_image') {
    const image = await readImage(op.imagePath)
    const relationships = await partRelationships(bundle.zip, partName)
    const relation = childElements(relationships.documentElement, 'Relationship').find(
      (node) => node.getAttribute('Id') === visual.descriptor.relationshipId
    )
    if (!relation)
      throw new Error(`image relationship not found: ${visual.descriptor.relationshipId}`)
    const nextTarget = nextImageTarget(bundle.zip, image.extension)
    relation.setAttribute('Target', nextTarget)
    await ensureImageContentType(bundle.zip, image.extension, image.contentType)
    bundle.zip.file(path.posix.join('word', nextTarget), image.bytes)
    persistPartRelationships(bundle.zip, partName, relationships)
  } else if (op.type === 'delete_media') {
    const removable = removableVisualNode(visual.node)
    removable.parentNode?.removeChild(removable)
    const relationshipId = visual.descriptor.relationshipId
    if (relationshipId) await removeUnusedRelationship(bundle, partName, relationshipId)
  } else {
    patchImageProperties(visual.node, op.widthCm, op.heightCm, op.altText)
  }
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: [changedNode(index, visual.descriptor.ownerNodeId, 'replace_node')]
  }
}

type CommentDomainOp = Extract<
  DocxOperation,
  { type: 'add_comment' | 'update_comment' | 'reply_comment' | 'delete_comment' }
>

const commentsDocument = async (zip: JSZip): Promise<Document> =>
  await packageDocument(
    zip,
    'word/comments.xml',
    `<w:comments xmlns:w="${WORD_NS}" xmlns:w14="${WORD_2010_NS}"/>`
  )

const commentElements = (comments: Document): Element[] =>
  childElements(comments.documentElement, 'comment')

const nextCommentId = (comments: Document): string => {
  const ids = commentElements(comments)
    .map((comment) => Number(getAttr(comment, 'id')))
    .filter(Number.isFinite)
  return String(Math.max(-1, ...ids) + 1)
}

const randomHexId = (): string => {
  const value = Math.floor(Math.random() * 0xffffffff)
  return value.toString(16).toUpperCase().padStart(8, '0')
}

const createCommentElement = (
  comments: Document,
  id: string,
  text: string,
  author: string,
  paragraphId: string
): Element => {
  const comment = wordElement(comments, 'comment')
  setWordAttr(comment, 'id', id)
  setWordAttr(comment, 'author', author)
  setWordAttr(comment, 'date', new Date().toISOString())
  setWordAttr(comment, 'initials', author.slice(0, 2).toUpperCase())
  const paragraph = wordElement(comments, 'p')
  paragraph.setAttributeNS(WORD_2010_NS, 'w14:paraId', paragraphId)
  paragraph.setAttributeNS(WORD_2010_NS, 'w14:textId', '77777777')
  paragraph.appendChild(createPlainParagraph(comments, text).firstChild as Node)
  comment.appendChild(paragraph)
  return comment
}

const replaceCommentText = (comment: Element, value: string): void => {
  const text = descendantElements(comment, 't').at(0)
  if (!text) {
    const paragraph =
      descendantElements(comment, 'p').at(0) || createPlainParagraph(comment.ownerDocument, '')
    if (!paragraph.parentNode) comment.appendChild(paragraph)
    const run = firstChildElement(paragraph, 'r') || wordElement(comment.ownerDocument, 'r')
    if (!run.parentNode) paragraph.appendChild(run)
    const created = wordElement(comment.ownerDocument, 't')
    run.appendChild(created)
    setText(created, value)
    return
  }
  setText(text, value)
  descendantElements(comment, 't')
    .slice(1)
    .forEach((extra) => setText(extra, ''))
}

const paragraphForCommentTarget = (index: NodeIndex, nodeId: string, text: string): Element => {
  const target = editableElement(index, nodeId)
  const paragraph =
    target.localName === 'p'
      ? target
      : target.localName === 'r'
        ? (() => {
            let current: Element | null = target.parentNode as Element | null
            while (current && current.localName !== 'p')
              current = current.parentNode as Element | null
            return current
          })()
        : descendantElements(target, 'p').find((candidate) =>
            (candidate.textContent || '').includes(text)
          )
  if (!paragraph || !(paragraph.textContent || '').includes(text)) {
    throw new Error(`comment text not found in target node: ${text}`)
  }
  return paragraph
}

const commentAnchorRuns = (
  paragraph: Element,
  query: string
): { first: Element; last: Element } => {
  const runs = descendantElements(paragraph, 'r').filter(
    (run) => descendantElements(run, 't').length > 0
  )
  let combined = ''
  const ranges = runs.map((run) => {
    const start = combined.length
    combined += descendantElements(run, 't')
      .map((node) => node.textContent || '')
      .join('')
    return { run, start, end: combined.length }
  })
  const start = combined.indexOf(query)
  if (start < 0) throw new Error(`comment text not found: ${query}`)
  const end = start + query.length
  const first = ranges.find((range) => range.end > start)?.run
  const last = [...ranges].reverse().find((range) => range.start < end)?.run
  if (!first || !last || first.parentNode !== last.parentNode) {
    throw new Error('comment range must be inside one paragraph content container')
  }
  return { first, last }
}

const appendCommentReference = (parent: Node, before: Node | null, commentId: string): void => {
  const doc = parent.ownerDocument!
  const run = wordElement(doc, 'r')
  const properties = wordElement(doc, 'rPr')
  const style = wordElement(doc, 'rStyle')
  setWordAttr(style, 'val', 'CommentReference')
  properties.appendChild(style)
  run.appendChild(properties)
  const reference = wordElement(doc, 'commentReference')
  setWordAttr(reference, 'id', commentId)
  run.appendChild(reference)
  parent.insertBefore(run, before)
}

const commentOwnerIds = (index: NodeIndex, commentId: string): string[] => {
  const owners = new Set<string>()
  const documents = [
    ...new Set([...index.nodesById.values()].map((entry) => entry.node.ownerDocument))
  ]
  documents
    .flatMap((document) => descendantElements(document.documentElement, 'commentReference'))
    .filter((node) => getAttr(node, 'id') === commentId)
    .forEach((reference) => {
      let current: Element | null = reference
      while (current) {
        const found = [...index.nodesById.values()].find((candidate) => candidate.node === current)
        if (found) {
          owners.add(found.nodeId)
          break
        }
        current = current.parentNode as Element | null
      }
    })
  return [...owners]
}

const commentsExtendedDocument = async (zip: JSZip): Promise<Document> =>
  await packageDocument(
    zip,
    'word/commentsExtended.xml',
    `<w15:commentsEx xmlns:w15="${WORD_2012_NS}"/>`
  )

const ensureCommentExtension = (
  extended: Document,
  paragraphId: string,
  parentParagraphId?: string
): void => {
  const exists = childElements(extended.documentElement, 'commentEx').some(
    (node) =>
      node.getAttributeNS(WORD_2012_NS, 'paraId') === paragraphId ||
      node.getAttribute('w15:paraId') === paragraphId
  )
  if (exists) return
  const item = extended.createElementNS(WORD_2012_NS, 'w15:commentEx')
  item.setAttributeNS(WORD_2012_NS, 'w15:paraId', paragraphId)
  item.setAttributeNS(WORD_2012_NS, 'w15:done', '0')
  if (parentParagraphId) item.setAttributeNS(WORD_2012_NS, 'w15:paraIdParent', parentParagraphId)
  extended.documentElement.appendChild(item)
}

const applyCommentDomainOp = async (
  buffer: Buffer,
  op: CommentDomainOp
): Promise<{ buffer: Buffer; changedNodes: DocxChangedNode[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  const comments = await commentsDocument(bundle.zip)
  let affectedOwners: string[] = []
  if (op.type === 'add_comment') {
    const paragraph = paragraphForCommentTarget(index, op.nodeId, op.text)
    const anchors = commentAnchorRuns(paragraph, op.text)
    const parent = anchors.first.parentNode
    if (!parent) throw new Error('comment range has no parent')
    const commentId = nextCommentId(comments)
    const start = wordElement(paragraph.ownerDocument, 'commentRangeStart')
    setWordAttr(start, 'id', commentId)
    const end = wordElement(paragraph.ownerDocument, 'commentRangeEnd')
    setWordAttr(end, 'id', commentId)
    parent.insertBefore(start, anchors.first)
    parent.insertBefore(end, anchors.last.nextSibling)
    appendCommentReference(parent, end.nextSibling, commentId)
    comments.documentElement.appendChild(
      createCommentElement(comments, commentId, op.comment, op.author || 'NCurator', randomHexId())
    )
    affectedOwners = [ownerNodeId(index, op.nodeId)]
  } else {
    const comment = commentElements(comments).find(
      (candidate) => getAttr(candidate, 'id') === op.commentId
    )
    if (!comment) throw new Error(`comment not found: ${op.commentId}`)
    affectedOwners = commentOwnerIds(index, op.commentId)
    if (op.type === 'update_comment') replaceCommentText(comment, op.comment)
    else if (op.type === 'delete_comment') {
      const extended = await commentsExtendedDocument(bundle.zip)
      const paragraph = descendantElements(comment, 'p').at(-1)
      const rootParagraphId = paragraph
        ? paragraph.getAttributeNS(WORD_2010_NS, 'paraId') ||
          paragraph.getAttribute('w14:paraId') ||
          ''
        : ''
      const deletedParagraphIds = new Set(rootParagraphId ? [rootParagraphId] : [])
      let expanded = true
      while (expanded) {
        expanded = false
        childElements(extended.documentElement, 'commentEx').forEach((item) => {
          const parentId =
            item.getAttributeNS(WORD_2012_NS, 'paraIdParent') ||
            item.getAttribute('w15:paraIdParent') ||
            ''
          const paragraphId =
            item.getAttributeNS(WORD_2012_NS, 'paraId') || item.getAttribute('w15:paraId') || ''
          if (
            parentId &&
            deletedParagraphIds.has(parentId) &&
            !deletedParagraphIds.has(paragraphId)
          ) {
            deletedParagraphIds.add(paragraphId)
            expanded = true
          }
        })
      }
      const deletedCommentIds = new Set<string>()
      commentElements(comments).forEach((candidate) => {
        const candidateParagraph = descendantElements(candidate, 'p').at(-1)
        const paragraphId = candidateParagraph
          ? candidateParagraph.getAttributeNS(WORD_2010_NS, 'paraId') ||
            candidateParagraph.getAttribute('w14:paraId') ||
            ''
          : ''
        if (candidate === comment || deletedParagraphIds.has(paragraphId)) {
          deletedCommentIds.add(getAttr(candidate, 'id'))
          comments.documentElement.removeChild(candidate)
        }
      })
      childElements(extended.documentElement, 'commentEx').forEach((item) => {
        const paragraphId =
          item.getAttributeNS(WORD_2012_NS, 'paraId') || item.getAttribute('w15:paraId') || ''
        if (deletedParagraphIds.has(paragraphId)) extended.documentElement.removeChild(item)
      })
      bundle.zip.file('word/commentsExtended.xml', new XMLSerializer().serializeToString(extended))
      ;['commentRangeStart', 'commentRangeEnd', 'commentReference'].forEach((name) => {
        storyDocuments(bundle)
          .flatMap((document) => descendantElements(document.documentElement, name))
          .filter((node) => deletedCommentIds.has(getAttr(node, 'id')))
          .forEach((node) => {
            const removable =
              name === 'commentReference' && node.parentNode?.nodeType === 1
                ? (node.parentNode as Element)
                : node
            removable.parentNode?.removeChild(removable)
          })
      })
    } else {
      const parentParagraph = descendantElements(comment, 'p').at(-1)
      const parentParagraphId = parentParagraph
        ? parentParagraph.getAttributeNS(WORD_2010_NS, 'paraId') ||
          parentParagraph.getAttribute('w14:paraId')
        : ''
      if (!parentParagraphId) throw new Error(`comment cannot receive a reply: ${op.commentId}`)
      const replyId = nextCommentId(comments)
      const replyParagraphId = randomHexId()
      comments.documentElement.appendChild(
        createCommentElement(
          comments,
          replyId,
          op.comment,
          op.author || 'NCurator',
          replyParagraphId
        )
      )
      const extended = await commentsExtendedDocument(bundle.zip)
      ensureCommentExtension(extended, parentParagraphId)
      ensureCommentExtension(extended, replyParagraphId, parentParagraphId)
      bundle.zip.file('word/commentsExtended.xml', new XMLSerializer().serializeToString(extended))
      await ensureDocumentRelationship(
        bundle.zip,
        COMMENTS_EXTENDED_REL_TYPE,
        'commentsExtended.xml'
      )
      await ensureContentTypeOverride(
        bundle.zip,
        '/word/commentsExtended.xml',
        'application/vnd.ms-word.commentsExtended+xml'
      )
    }
  }
  bundle.zip.file('word/comments.xml', new XMLSerializer().serializeToString(comments))
  await ensureDocumentRelationship(bundle.zip, COMMENTS_REL_TYPE, 'comments.xml')
  await ensureContentTypeOverride(
    bundle.zip,
    '/word/comments.xml',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml'
  )
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes: affectedOwners.map((id) => changedNode(index, id, 'replace_node'))
  }
}

const directParagraphs = (root: Element): Element[] => {
  const out: Element[] = []
  const visit = (node: Element): void => {
    if (node.localName === 'p') out.push(node)
    childElements(node).forEach(visit)
  }
  visit(root)
  return out
}

const isVisualBoundary = (name: string): boolean =>
  ['drawing', 'pict', 'object', 'graphic', 'AlternateContent'].includes(name)

const textSegments = (paragraph: Element): Element[][] => {
  const segments: Element[][] = []
  let current: Element[] = []
  const flush = (): void => {
    if (current.length > 0) segments.push(current)
    current = []
  }
  const visit = (node: Element): void => {
    if (node !== paragraph && node.localName === 'p') return
    if (node.localName === 'del' || node.localName === 'moveFrom') return
    if (node.localName === 'tab' || node.localName === 'br' || isVisualBoundary(node.localName)) {
      flush()
      return
    }
    if (node.localName === 'instrText' || node.localName === 'delText') return
    if (node.localName === 't') {
      current.push(node)
      return
    }
    childElements(node).forEach(visit)
  }
  visit(paragraph)
  flush()
  return segments
}

const replaceInSegment = (nodes: Element[], query: string, replacement: string): boolean => {
  let changed = false
  let from = 0
  while (true) {
    const combined = nodes.map((node) => node.textContent || '').join('')
    const start = combined.indexOf(query, from)
    if (start < 0) return changed
    const end = start + query.length
    let cursor = 0
    let inserted = false
    nodes.forEach((node) => {
      const value = node.textContent || ''
      const nodeStart = cursor
      const nodeEnd = cursor + value.length
      cursor = nodeEnd
      if (nodeEnd <= start || nodeStart >= end) return
      const before = nodeStart < start ? value.slice(0, start - nodeStart) : ''
      const after = nodeEnd > end ? value.slice(end - nodeStart) : ''
      setText(node, `${before}${inserted ? '' : replacement}${after}`)
      inserted = true
    })
    changed = true
    from = start + replacement.length
  }
}

const ensureProperties = (node: Element, name: string): Element => {
  const existing = firstChildElement(node, name)
  if (existing) return existing
  const properties = wordElement(node.ownerDocument, name)
  node.insertBefore(properties, node.firstChild)
  return properties
}

const removeProperty = (properties: Element, name: string): void => {
  childElements(properties, name).forEach((node) => properties.removeChild(node))
}

const setValProperty = (
  properties: Element,
  name: string,
  value: string | number | boolean | null | undefined
): void => {
  if (value === undefined) return
  removeProperty(properties, name)
  if (value === null) return
  const node = wordElement(properties.ownerDocument, name)
  if (typeof value === 'boolean') {
    if (!value) setWordAttr(node, 'val', '0')
  } else setWordAttr(node, 'val', String(value))
  properties.appendChild(node)
}

const ptToTwips = (value: number): number => Math.round(value * 20)

const patchBorders = (
  properties: Element,
  name: string,
  value: DocxBorders | null | undefined
): void => {
  if (value === undefined) return
  removeProperty(properties, name)
  if (value === null) return
  const container = wordElement(properties.ownerDocument, name)
  const sideNames: Record<string, string> = {
    insideHorizontal: 'insideH',
    insideVertical: 'insideV'
  }
  Object.entries(value).forEach(([side, border]) => {
    if (border) {
      const node = wordElement(properties.ownerDocument, sideNames[side] || side)
      setWordAttr(node, 'val', border.style)
      if (border.color) setWordAttr(node, 'color', normalizeDocxHexColor(border.color))
      if (border.size !== undefined) setWordAttr(node, 'sz', String(Math.round(border.size * 8)))
      container.appendChild(node)
    }
  })
  properties.appendChild(container)
}

const patchRunProperties = (
  run: Element,
  patch: Extract<DocxStylePatch, { kind: 'run' }>
): void => {
  const rPr = ensureProperties(run, 'rPr')
  setValProperty(rPr, 'b', patch.bold)
  setValProperty(rPr, 'i', patch.italic)
  setValProperty(rPr, 'strike', patch.strike)
  if (patch.underline !== undefined)
    setValProperty(rPr, 'u', patch.underline === null ? null : patch.underline ? 'single' : 'none')
  setValProperty(
    rPr,
    'color',
    patch.color === undefined || patch.color === null
      ? patch.color
      : normalizeDocxHexColor(patch.color)
  )
  if (patch.highlight !== undefined) {
    removeProperty(rPr, 'shd')
    if (patch.highlight !== null) {
      const shading = wordElement(run.ownerDocument, 'shd')
      setWordAttr(shading, 'fill', normalizeDocxHexColor(patch.highlight))
      rPr.appendChild(shading)
    }
  }
  setValProperty(
    rPr,
    'sz',
    patch.fontSize === undefined || patch.fontSize === null
      ? patch.fontSize
      : Math.round(patch.fontSize * 2)
  )
  if (patch.fontFamily !== undefined) {
    removeProperty(rPr, 'rFonts')
    if (patch.fontFamily !== null) {
      const fonts = wordElement(run.ownerDocument, 'rFonts')
      setWordAttr(fonts, 'ascii', patch.fontFamily)
      setWordAttr(fonts, 'eastAsia', patch.fontFamily)
      rPr.appendChild(fonts)
    }
  }
}

const patchParagraphProperties = (
  node: Element,
  patch: Extract<DocxStylePatch, { kind: 'paragraph' }>
): void => {
  const pPr = ensureProperties(node, 'pPr')
  setValProperty(pPr, 'pStyle', patch.styleId)
  setValProperty(pPr, 'jc', patch.alignment)
  setValProperty(pPr, 'keepNext', patch.keepWithNext)
  setValProperty(pPr, 'pageBreakBefore', patch.pageBreakBefore)
  if (patch.indent !== undefined) {
    removeProperty(pPr, 'ind')
    if (patch.indent !== null) {
      const ind = wordElement(node.ownerDocument, 'ind')
      Object.entries(patch.indent).forEach(([key, value]) => {
        if (value !== undefined) setWordAttr(ind, key, String(ptToTwips(value)))
      })
      pPr.appendChild(ind)
    }
  }
  if (patch.spacing !== undefined) {
    removeProperty(pPr, 'spacing')
    if (patch.spacing !== null) {
      const spacing = wordElement(node.ownerDocument, 'spacing')
      Object.entries(patch.spacing).forEach(([key, value]) => {
        if (value !== undefined) setWordAttr(spacing, key, String(ptToTwips(value)))
      })
      pPr.appendChild(spacing)
    }
  }
}

const setWidth = (
  properties: Element,
  name: string,
  width: { value: number; unit: 'pt' | 'percent' } | null | undefined
): void => {
  if (width === undefined) return
  removeProperty(properties, name)
  if (width === null) return
  const node = wordElement(properties.ownerDocument, name)
  setWordAttr(
    node,
    'w',
    String(Math.round(width.unit === 'percent' ? width.value * 50 : width.value * 20))
  )
  setWordAttr(node, 'type', width.unit === 'percent' ? 'pct' : 'dxa')
  properties.appendChild(node)
}

const patchNodeStyle = (node: Element, patch: DocxStylePatch): void => {
  if (patch.kind === 'run') return patchRunProperties(node, patch)
  if (patch.kind === 'paragraph') return patchParagraphProperties(node, patch)
  if (patch.kind === 'table') {
    const pr = ensureProperties(node, 'tblPr')
    setValProperty(pr, 'jc', patch.alignment)
    setWidth(pr, 'tblW', patch.width)
    setValProperty(pr, 'tblLayout', patch.layout)
    patchBorders(pr, 'tblBorders', patch.borders)
    return
  }
  if (patch.kind === 'table_row') {
    const pr = ensureProperties(node, 'trPr')
    setValProperty(pr, 'tblHeader', patch.repeatHeader)
    setValProperty(pr, 'cantSplit', patch.cantSplit)
    setValProperty(
      pr,
      'trHeight',
      patch.height === undefined || patch.height === null ? patch.height : ptToTwips(patch.height)
    )
    return
  }
  const pr = ensureProperties(node, 'tcPr')
  setWidth(pr, 'tcW', patch.width)
  setValProperty(pr, 'vAlign', patch.verticalAlignment)
  if (patch.shading !== undefined) {
    removeProperty(pr, 'shd')
    if (patch.shading !== null) {
      const shd = wordElement(node.ownerDocument, 'shd')
      setWordAttr(shd, 'fill', normalizeDocxHexColor(patch.shading))
      pr.appendChild(shd)
    }
  }
  if (patch.margins !== undefined) {
    removeProperty(pr, 'tcMar')
    if (patch.margins !== null) {
      const margins = wordElement(node.ownerDocument, 'tcMar')
      Object.entries(patch.margins).forEach(([side, value]) => {
        if (value === undefined) return
        const margin = wordElement(node.ownerDocument, side)
        setWordAttr(margin, 'w', String(ptToTwips(value)))
        setWordAttr(margin, 'type', 'dxa')
        margins.appendChild(margin)
      })
      pr.appendChild(margins)
    }
  }
  patchBorders(pr, 'tcBorders', patch.borders)
}

const runForText = (text: Element): Element | null => {
  let current: Node | null = text.parentNode
  while (current && isElementNode(current)) {
    if (current.localName === 'r') return current
    current = current.parentNode
  }
  return null
}

const descendantTextElements = (root: Element): Element[] => {
  const out: Element[] = []
  const visit = (node: Element): void => {
    if (node.localName === 't') {
      out.push(node)
      return
    }
    childElements(node).forEach(visit)
  }
  visit(root)
  return out
}

const styleTextRangesInRun = (
  run: Element,
  rangesByText: ReadonlyMap<Element, Array<{ start: number; end: number }>>,
  patch: Extract<DocxStylePatch, { kind: 'run' }>
): void => {
  if (!run.parentNode) return
  const texts = descendantTextElements(run)
  if (texts.some((text) => text.parentNode !== run)) {
    patchRunProperties(run, patch)
    return
  }

  const parts: Array<{ node: Element; styled: boolean }> = []
  childElements(run).forEach((child) => {
    if (child.localName === 'rPr') return
    if (child.localName !== 't') {
      parts.push({ node: child.cloneNode(true) as Element, styled: false })
      return
    }
    const value = child.textContent || ''
    const ranges = rangesByText.get(child) || []
    if (ranges.length === 0) {
      parts.push({ node: child.cloneNode(true) as Element, styled: false })
      return
    }
    const boundaries = new Set([0, value.length])
    ranges.forEach((range) => {
      boundaries.add(Math.max(0, range.start))
      boundaries.add(Math.min(value.length, range.end))
    })
    const points = [...boundaries].sort((left, right) => left - right)
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index]!
      const end = points[index + 1]!
      if (start === end) continue
      const clone = child.cloneNode(true) as Element
      setText(clone, value.slice(start, end))
      parts.push({
        node: clone,
        styled: ranges.some((range) => range.start < end && range.end > start)
      })
    }
  })

  const property = firstChildElement(run, 'rPr')
  let current: { run: Element; styled: boolean } | undefined
  parts.forEach((part) => {
    if (!current || current.styled !== part.styled) {
      const clone = run.cloneNode(false) as Element
      if (property) clone.appendChild(property.cloneNode(true))
      if (part.styled) patchRunProperties(clone, patch)
      run.parentNode!.insertBefore(clone, run)
      current = { run: clone, styled: part.styled }
    }
    current.run.appendChild(part.node)
  })
  if (parts.length > 0) {
    run.parentNode.removeChild(run)
  }
}

const styleMatchesInParagraph = (
  paragraph: Element,
  query: string,
  patch: Extract<DocxStylePatch, { kind: 'run' }>
): boolean => {
  let changed = false
  const rangesByRun = new Map<Element, Map<Element, Array<{ start: number; end: number }>>>()
  textSegments(paragraph).forEach((segment) => {
    const combined = segment.map((node) => node.textContent || '').join('')
    const ranges: Array<{ start: number; end: number }> = []
    let from = 0
    while (true) {
      const start = combined.indexOf(query, from)
      if (start < 0) break
      ranges.push({ start, end: start + query.length })
      from = start + query.length
    }
    if (ranges.length === 0) return
    let cursor = 0
    segment.forEach((text) => {
      const value = text.textContent || ''
      const start = cursor
      const end = cursor + value.length
      cursor = end
      const localRanges = ranges
        .filter((range) => range.start < end && range.end > start)
        .map((range) => ({
          start: Math.max(0, range.start - start),
          end: Math.min(value.length, range.end - start)
        }))
      if (localRanges.length === 0) return
      const run = runForText(text)
      if (!run) return
      const rangesByText = rangesByRun.get(run) || new Map()
      rangesByText.set(text, [...(rangesByText.get(text) || []), ...localRanges])
      rangesByRun.set(run, rangesByText)
      changed = true
    })
  })
  rangesByRun.forEach((rangesByText, run) => styleTextRangesInRun(run, rangesByText, patch))
  return changed
}

const expectedKind = (kind: string): DocxStylePatch['kind'] =>
  kind === 'paragraph'
    ? 'paragraph'
    : kind === 'table'
      ? 'table'
      : kind === 'table_row'
        ? 'table_row'
        : kind === 'table_cell'
          ? 'table_cell'
          : 'run'

export const validateDocxOperationTargets = async (
  buffer: Buffer,
  operations: DocxOperation[]
): Promise<void> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  operations.forEach((operation) => {
    if (
      operation.type !== 'format_text' &&
      operation.type !== 'format_paragraph' &&
      operation.type !== 'format_table' &&
      operation.type !== 'format_row' &&
      operation.type !== 'format_cell' &&
      operation.type !== 'format_section' &&
      operation.type !== 'reset_format' &&
      operation.type !== 'apply_named_style' &&
      operation.type !== 'set_numbering'
    ) {
      return
    }
    const node = index.nodesById.get(operation.nodeId)
    const actualKind = node?.kind
    const element = node?.node
    if (!actualKind || !element) throw new Error(`format target not found: ${operation.nodeId}`)
    if (operation.type === 'format_text') {
      const targetText = collectText(element)
      if (operation.text && !targetText.includes(operation.text)) {
        throw new Error(`format_text target text not found: ${operation.nodeId}`)
      }
      if (!operation.text && targetText.length === 0) {
        throw new Error(`format_text target contains no text: ${operation.nodeId}`)
      }
      return
    }
    if (
      operation.type === 'reset_format' &&
      !['r', 'p', 'tbl', 'tr', 'tc'].includes(element.localName)
    ) {
      throw new Error(`reset_format does not support ${element.localName}`)
    }
    if (operation.type === 'format_section') {
      if (node?.story.type !== 'body') {
        throw new Error('format_section target must be in the document body')
      }
    }
    const requiredKind =
      operation.type === 'format_paragraph' || operation.type === 'apply_named_style'
        ? 'paragraph'
        : operation.type === 'format_table'
          ? 'table'
          : operation.type === 'format_row'
            ? 'table_row'
            : operation.type === 'format_cell'
              ? 'table_cell'
              : operation.type === 'set_numbering'
                ? 'paragraph'
                : undefined
    if (requiredKind && actualKind !== requiredKind) {
      throw new Error(
        `format patch type mismatch: target is ${actualKind}, expected ${requiredKind}`
      )
    }
  })
}

type DirectFormatOp = Extract<
  DocxOperation,
  {
    type:
      | 'format_text'
      | 'format_paragraph'
      | 'format_table'
      | 'format_row'
      | 'format_cell'
      | 'apply_named_style'
  }
>

const applyDirectFormat = async (buffer: Buffer, op: DirectFormatOp) => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildCurrentIndex(bundle)
  const changedNodes: DocxChangedNode[] = []
  const owner = ownerNodeId(index, op.nodeId)
  const beforeText = extractNodeText(index, owner)
  if (op.type === 'format_text') {
    const target = editableElement(index, op.nodeId)
    let changed = false
    const textScopes = directParagraphs(target)
    if (textScopes.length === 0) textScopes.push(target)
    textScopes.forEach((paragraph) => {
      if (op.text) {
        if (styleMatchesInParagraph(paragraph, op.text, { kind: 'run', ...op.format })) {
          changed = true
        }
        return
      }
      const runs = paragraph.localName === 'r' ? [paragraph] : descendantElements(paragraph, 'r')
      runs
        .filter((run) => descendantElements(run, 't').some((text) => Boolean(text.textContent)))
        .forEach((run) => {
          patchRunProperties(run, { kind: 'run', ...op.format })
          changed = true
        })
    })
    if (!changed) throw new Error('format_text target contains no text')
  } else {
    const node = index.nodesById.get(op.nodeId)
    const actualKind = node?.kind
    const element = node?.node
    if (!actualKind || !element) throw new Error(`format target not found: ${op.nodeId}`)
    const patch: DocxStylePatch =
      op.type === 'format_paragraph'
        ? { kind: 'paragraph', ...op.format }
        : op.type === 'format_table'
          ? { kind: 'table', ...op.format }
          : op.type === 'format_row'
            ? { kind: 'table_row', ...op.format }
            : op.type === 'format_cell'
              ? { kind: 'table_cell', ...op.format }
              : { kind: 'paragraph', styleId: op.styleId }
    if (expectedKind(actualKind) !== patch.kind)
      throw new Error(`format patch type mismatch: target is ${actualKind}, patch is ${patch.kind}`)
    patchNodeStyle(element, patch)
  }
  changedNodes.push({ action: 'format', nodeId: owner, beforeText, afterText: beforeText })
  return {
    buffer: await writeDocumentXml(bundle),
    changedNodes
  }
}

export const applyDocxOps = async (input: {
  buffer: Buffer
  ops: DocxOperation[]
}): Promise<ApplyOpsResult> => {
  let buffer = input.buffer
  const changedNodes: DocxChangedNode[] = []
  for (const op of input.ops) {
    if (op.type === 'create_document') continue
    if (
      op.type === 'replace_text' ||
      op.type === 'insert_nodes' ||
      op.type === 'replace_node' ||
      op.type === 'delete_node'
    ) {
      const result = await applyContentDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'format_text' ||
      op.type === 'format_paragraph' ||
      op.type === 'format_table' ||
      op.type === 'format_row' ||
      op.type === 'format_cell' ||
      op.type === 'apply_named_style'
    ) {
      const result = await applyDirectFormat(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (op.type === 'move_node') {
      const result = await applyMoveNode(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'create_table' ||
      op.type === 'delete_table' ||
      op.type === 'insert_row' ||
      op.type === 'delete_row' ||
      op.type === 'insert_column' ||
      op.type === 'delete_column' ||
      op.type === 'merge_cells' ||
      op.type === 'split_cell'
    ) {
      const result = await applyTableDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'format_section' ||
      op.type === 'reset_format' ||
      op.type === 'create_named_style' ||
      op.type === 'update_named_style' ||
      op.type === 'delete_named_style' ||
      op.type === 'set_numbering'
    ) {
      const result = await applyFormatDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'enable_track_changes' ||
      op.type === 'disable_track_changes' ||
      op.type === 'accept_revision' ||
      op.type === 'reject_revision' ||
      op.type === 'accept_all_revisions' ||
      op.type === 'reject_all_revisions'
    ) {
      const result = await applyRevisionDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'insert_image' ||
      op.type === 'replace_image' ||
      op.type === 'delete_media' ||
      op.type === 'update_image'
    ) {
      const result = await applyMediaDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else if (
      op.type === 'add_comment' ||
      op.type === 'update_comment' ||
      op.type === 'reply_comment' ||
      op.type === 'delete_comment'
    ) {
      const result = await applyCommentDomainOp(buffer, op)
      buffer = result.buffer
      changedNodes.push(...result.changedNodes)
    } else {
      throw new Error('DOCX operation is not implemented by the OOXML writer')
    }
  }
  return { buffer, changedNodes }
}
