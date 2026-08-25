import fs from 'node:fs/promises'
import path from 'node:path'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import type JSZip from 'jszip'
import { childElements, firstChildElement, isElementNode } from '../adapters/ooxml/dom'
import { buildDocumentNodeIndex, loadDocxBundle } from '../adapters/ooxml/nodeIndex'
import type { IndexedNode } from '../adapters/ooxml/types'
import { findNewDocxValidationProblems, validateDocxBuffer } from '../adapters/ooxml/validator'
import { createNodeElementFromSpec, createParagraphElementFromSpec } from '../utils/specDom'
import type { DocxNodeSpec, DocxReplayNode, DocxReplaySession } from '../types'
import { projectCommittedView, projectReviewView } from './viewProjector'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type RevisionKind = 'inserted' | 'deleted'

const ensureDirForFile = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

const setWordAttribute = (node: Element, localName: string, value: string): void => {
  node.setAttribute(`w:${localName}`, value)
}

const cloneElement = (node: Element): Element => node.cloneNode(true) as Element

const clearChildren = (node: Element): void => {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}

const getOrCreateChild = (node: Element, localName: string): Element => {
  const existing = firstChildElement(node, localName)
  if (existing) return existing
  const created = node.ownerDocument.createElementNS(WORD_NS, `w:${localName}`)
  node.insertBefore(created, node.firstChild)
  return created
}

const styleRunForRevision = (run: Element, kind: RevisionKind): void => {
  const rPr = getOrCreateChild(run, 'rPr')
  childElements(rPr)
    .filter(
      (child) =>
        child.localName === 'color' || child.localName === 'shd' || child.localName === 'strike'
    )
    .forEach((child) => rPr.removeChild(child))
  if (kind === 'deleted') {
    const strike = run.ownerDocument.createElementNS(WORD_NS, 'w:strike')
    const color = run.ownerDocument.createElementNS(WORD_NS, 'w:color')
    const shade = run.ownerDocument.createElementNS(WORD_NS, 'w:shd')
    setWordAttribute(color, 'val', 'B42318')
    setWordAttribute(shade, 'fill', 'FDECEC')
    rPr.appendChild(strike)
    rPr.appendChild(color)
    rPr.appendChild(shade)
    return
  }

  const color = run.ownerDocument.createElementNS(WORD_NS, 'w:color')
  const shade = run.ownerDocument.createElementNS(WORD_NS, 'w:shd')
  setWordAttribute(color, 'val', '166534')
  setWordAttribute(shade, 'fill', 'E9F7EF')
  rPr.appendChild(color)
  rPr.appendChild(shade)
}

const applyRevisionToRuns = (element: Element, kind: RevisionKind): void => {
  const children = Array.from({ length: element.childNodes.length })
    .map((_, index) => element.childNodes.item(index))
    .filter(Boolean)

  children.forEach((child) => {
    if (!isElementNode(child)) return
    if (child.localName === 'r') {
      styleRunForRevision(child, kind)
      return
    }
    applyRevisionToRuns(child, kind)
  })
}

const getRunText = (run: Element): string =>
  Array.from({ length: run.childNodes.length })
    .map((_, index) => run.childNodes.item(index))
    .filter(Boolean)
    .map((child) => {
      if (!isElementNode(child)) return child.textContent || ''
      if (child.localName === 't') return child.textContent || ''
      return getRunText(child)
    })
    .join('')

const collectRunElements = (element: Element): Element[] => {
  const result: Element[] = []
  const stack: Element[] = [element]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current) continue
    if (current.localName === 'r') {
      result.push(current)
      continue
    }
    Array.from({ length: current.childNodes.length })
      .map((_, index) => current.childNodes.item(index))
      .filter(isElementNode)
      .forEach((child) => stack.push(child))
  }
  return result
}

const applyFormattedMarker = (element: Element, query?: string): void => {
  const normalizedQuery = String(query || '').trim()
  const runs = collectRunElements(element)
  if (runs.length === 0) return

  const matchedRuns =
    normalizedQuery.length > 0
      ? runs.filter((run) => getRunText(run).includes(normalizedQuery))
      : runs
  const targetRuns = matchedRuns.length > 0 ? matchedRuns : runs
  targetRuns.forEach((run) => styleRunForRevision(run, 'inserted'))
}

const getTableCell = (table: Element, rowIndex: number, colIndex: number): Element | undefined => {
  const row = childElements(table, 'tr')[rowIndex]
  return row ? childElements(row, 'tc')[colIndex] : undefined
}

const replaceCellWithReviewContent = (
  cell: Element,
  change: NonNullable<DocxReplayNode['tableCellChanges']>[number]
): void => {
  const currentParagraphs = childElements(cell, 'p').map(cloneElement)
  childElements(cell)
    .filter((child) => child.localName !== 'tcPr')
    .forEach((child) => cell.removeChild(child))

  change.before.paragraphs.forEach((paragraphSpec) => {
    const paragraph = createParagraphElementFromSpec(cell.ownerDocument, paragraphSpec)
    applyRevisionToRuns(paragraph, 'deleted')
    cell.appendChild(paragraph)
  })
  currentParagraphs.forEach((paragraph) => {
    applyRevisionToRuns(paragraph, 'inserted')
    cell.appendChild(paragraph)
  })
}

const applyTableCellReviewMarkers = (element: Element, node: DocxReplayNode): boolean => {
  if (element.localName !== 'tbl' || !node.tableCellChanges?.length) return false
  node.tableCellChanges.forEach((change) => {
    const cell = getTableCell(element, change.rowIndex, change.colIndex)
    if (!cell) return
    if (change.kind === 'formatted') {
      applyRevisionToRuns(cell, 'inserted')
      return
    }
    replaceCellWithReviewContent(cell, change)
  })
  return true
}

const getBody = (doc: Document): Element => {
  const bodies = doc.getElementsByTagNameNS(WORD_NS, 'body')
  const body = bodies.item(0)
  if (!body) throw new Error('word/document.xml has no w:body')
  return body
}

const clearBodyContent = (body: Element): void => {
  const removable = Array.from({ length: body.childNodes.length })
    .map((_, index) => body.childNodes.item(index))
    .filter(Boolean)
    .filter((child) => isElementNode(child) && child.localName !== 'sectPr')

  removable.forEach((child) => body.removeChild(child))
}

const writeDocumentXml = async (zip: JSZip, doc: Document): Promise<Buffer> => {
  const xml = new XMLSerializer().serializeToString(doc)
  zip.file('word/document.xml', xml)
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
}

const assertNoNewDocxValidationProblems = async (
  sourceBuffer: Buffer,
  buffer: Buffer,
  context: string
): Promise<void> => {
  const problems = findNewDocxValidationProblems(
    await validateDocxBuffer(sourceBuffer),
    await validateDocxBuffer(buffer)
  )
  if (problems.length === 0) return
  throw new Error(
    `${context}: ${problems.map((problem) => `${problem.code}:${problem.message}`).join('; ')}`
  )
}

const isRenderableIndexedNode = (
  node: IndexedNode | undefined
): node is Exclude<IndexedNode, { kind: 'table_cell' }> =>
  Boolean(node && node.kind !== 'table_cell')

const parseSnapshotElement = (rawXml: string): Element | null => {
  if (!rawXml) return null
  const element = new DOMParser().parseFromString(rawXml, 'application/xml').documentElement
  return element &&
    ['p', 'tbl', 'sdt', 'ins', 'del', 'moveFrom', 'moveTo'].includes(element.localName)
    ? element
    : null
}

const resolveElementForNode = (input: {
  shellDocument: Document
  node: DocxReplayNode
  session: DocxReplaySession
  currentIndex: ReturnType<typeof buildDocumentNodeIndex>
  sourceIndex: ReturnType<typeof buildDocumentNodeIndex>
}): { element: Element; reconstructed: boolean } => {
  const shouldUseSourceView =
    input.node.reviewState === 'deleted' || input.node.reviewState === 'replaced-old'

  if (!shouldUseSourceView) {
    const currentNodeId = input.node.currentNodeId || input.node.nodeId
    const currentSnapshotNode = currentNodeId
      ? input.session.activeSnapshot.nodeById.get(currentNodeId)
      : undefined
    const currentInternalNodeId = currentSnapshotNode
      ? input.currentIndex.bodyNodeIds[currentSnapshotNode.nodeIndex]
      : currentNodeId
    const currentNode = currentInternalNodeId
      ? input.currentIndex.nodesById.get(currentInternalNodeId)
      : undefined
    const renderableCurrentNode = isRenderableIndexedNode(currentNode) ? currentNode : null
    if (renderableCurrentNode) {
      return { element: cloneElement(renderableCurrentNode.node), reconstructed: false }
    }
    const currentSnapshotElement = parseSnapshotElement(currentSnapshotNode?.rawXml || '')
    if (currentSnapshotElement) {
      return { element: cloneElement(currentSnapshotElement), reconstructed: false }
    }
  }

  const sourceNodeId = input.node.sourceNodeId || input.node.nodeId
  const sourceSnapshotNode = sourceNodeId
    ? input.session.sourceSnapshot.nodeById.get(sourceNodeId)
    : undefined
  const sourceInternalNodeId = sourceSnapshotNode
    ? input.sourceIndex.bodyNodeIds[sourceSnapshotNode.nodeIndex]
    : sourceNodeId
  const sourceNode = sourceInternalNodeId
    ? input.sourceIndex.nodesById.get(sourceInternalNodeId)
    : undefined
  const renderableSourceNode = isRenderableIndexedNode(sourceNode) ? sourceNode : null
  if (renderableSourceNode) {
    return { element: cloneElement(renderableSourceNode.node), reconstructed: false }
  }
  const sourceSnapshotElement = parseSnapshotElement(sourceSnapshotNode?.rawXml || '')
  if (sourceSnapshotElement) {
    return { element: cloneElement(sourceSnapshotElement), reconstructed: false }
  }

  return {
    element: createNodeElementFromSpec(input.shellDocument, input.node.spec, null),
    reconstructed: true
  }
}

const applyReviewMarker = (element: Element, node: DocxReplayNode): void => {
  if (applyTableCellReviewMarkers(element, node)) return
  if (node.reviewState === 'formatted') {
    applyFormattedMarker(element, node.reviewQuery)
    return
  }
  if (node.reviewState === 'inserted' || node.reviewState === 'replaced-new') {
    applyRevisionToRuns(element, 'inserted')
    return
  }
  if (node.reviewState === 'deleted' || node.reviewState === 'replaced-old') {
    applyRevisionToRuns(element, 'deleted')
  }
}

const ensureStableTableLayout = (
  table: Element,
  spec: Extract<DocxNodeSpec, { kind: 'table' }>
): void => {
  const columnCount = Math.max(1, ...spec.rows.map((row) => row.length))
  const tableWidth = 9072
  const columnWidth = Math.max(720, Math.floor(tableWidth / columnCount))
  const doc = table.ownerDocument

  const tblPr = getOrCreateChild(table, 'tblPr')
  const tblW = firstChildElement(tblPr, 'tblW') || doc.createElementNS(WORD_NS, 'w:tblW')
  const tblLayout =
    firstChildElement(tblPr, 'tblLayout') || doc.createElementNS(WORD_NS, 'w:tblLayout')
  setWordAttribute(tblW, 'w', String(tableWidth))
  setWordAttribute(tblW, 'type', 'dxa')
  setWordAttribute(tblLayout, 'type', 'fixed')
  if (!tblW.parentNode) tblPr.appendChild(tblW)
  if (!tblLayout.parentNode) tblPr.appendChild(tblLayout)

  let tblGrid = firstChildElement(table, 'tblGrid')
  if (!tblGrid) {
    tblGrid = doc.createElementNS(WORD_NS, 'w:tblGrid')
    table.insertBefore(tblGrid, table.firstChild?.nextSibling || null)
  }
  clearChildren(tblGrid)
  for (let index = 0; index < columnCount; index += 1) {
    const gridCol = doc.createElementNS(WORD_NS, 'w:gridCol')
    setWordAttribute(gridCol, 'w', String(columnWidth))
    tblGrid.appendChild(gridCol)
  }

  childElements(table, 'tr').forEach((row) => {
    childElements(row, 'tc').forEach((cell) => {
      const tcPr = getOrCreateChild(cell, 'tcPr')
      const tcW = firstChildElement(tcPr, 'tcW') || doc.createElementNS(WORD_NS, 'w:tcW')
      setWordAttribute(tcW, 'w', String(columnWidth))
      setWordAttribute(tcW, 'type', 'dxa')
      if (!tcW.parentNode) tcPr.appendChild(tcW)
    })
  })
}

export const materializeDocxProjectedArtifact = async (input: {
  sourceBuffer: Buffer
  workingBuffer: Buffer
  session: DocxReplaySession
  kind: 'review' | 'committed'
  outPath: string
}): Promise<void> => {
  const workingBundle = await loadDocxBundle(input.workingBuffer)
  const sourceBundle = await loadDocxBundle(input.sourceBuffer)
  const currentIndex = buildDocumentNodeIndex(workingBundle)
  const sourceIndex = buildDocumentNodeIndex(sourceBundle)
  const body = getBody(workingBundle.documentDom)
  const sectPr = firstChildElement(body, 'sectPr')
  clearBodyContent(body)

  const projectedNodes =
    input.kind === 'review' ? projectReviewView(input.session) : projectCommittedView(input.session)
  projectedNodes
    .filter((node) => node.story.type === 'body')
    .forEach((node) => {
      const resolved = resolveElementForNode({
        shellDocument: workingBundle.documentDom,
        node,
        session: input.session,
        currentIndex,
        sourceIndex
      })
      const element = resolved.element
      if (resolved.reconstructed && node.kind === 'table' && node.spec.kind === 'table') {
        ensureStableTableLayout(element, node.spec)
      }
      if (input.kind === 'review') {
        applyReviewMarker(element, node)
      }
      if (sectPr) {
        body.insertBefore(element, sectPr)
      } else {
        body.appendChild(element)
      }
    })

  const buffer = await writeDocumentXml(workingBundle.zip, workingBundle.documentDom)
  await assertNoNewDocxValidationProblems(
    input.sourceBuffer,
    buffer,
    input.kind === 'review'
      ? 'review_artifact_invalid_generated'
      : 'committed_artifact_invalid_generated'
  )
  await ensureDirForFile(input.outPath)
  await fs.writeFile(input.outPath, buffer)
}
