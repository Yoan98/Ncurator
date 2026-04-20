import fs from 'node:fs/promises'
import path from 'node:path'
import { XMLSerializer } from '@xmldom/xmldom'
import type JSZip from 'jszip'
import type { DraftSourceVersion, JsonValue } from '../../../../../../../shared/types'
import {
  buildBlockIndex,
  loadDocxBundle,
  paragraphNodeToSpec
} from '../adapters/ooxml/blockIndex'
import { validateDocxBuffer } from '../adapters/ooxml/validator'
import { childElements, collectText, descendantElements, firstChildElement, isElementNode } from '../adapters/ooxml/dom'
import type { IndexedNode } from '../adapters/ooxml/types'
import type { DocxBlockSpec, DocxParagraphSpec, DocxTableSpec } from '../types'
import {
  DOCX_CONFIRM_ANCHOR_PREFIX,
  DOCX_CONFIRM_BOOKMARK_ID_BASE,
  DOCX_CONFIRM_MANIFEST_VERSION
} from './constants'
import type {
  DocxConfirmManifest,
  DocxConfirmManifestChange,
  RunDraftChangeSeed
} from './types'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const SYSTEM_AUTHOR = 'NCurator AI'

type RevisionKind = 'inserted' | 'deleted'

const ensureDirForFile = async (filePath: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
}

const assertValidDocxBuffer = async (buffer: Buffer, context: string): Promise<void> => {
  const problems = await validateDocxBuffer(buffer)
  if (problems.length === 0) return
  throw new Error(
    `${context}: ${problems.map((problem) => `${problem.code}:${problem.message}`).join('; ')}`
  )
}

const writeDocumentXml = async (zip: JSZip, doc: Document): Promise<Buffer> => {
  const xml = new XMLSerializer().serializeToString(doc)
  zip.file('word/document.xml', xml)
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
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

const wrapRunWithRevision = (run: Element, kind: RevisionKind, _revisionId: number): Element => {
  styleRunForRevision(run, kind)
  return run
}

const applyRevisionToRuns = (element: Element, kind: RevisionKind, revisionId: number): void => {
  const children = Array.from({ length: element.childNodes.length })
    .map((_, index) => element.childNodes.item(index))
    .filter(Boolean)

  children.forEach((child) => {
    if (!isElementNode(child)) return
    if (child.localName === 'r') {
      const wrapped = wrapRunWithRevision(cloneElement(child), kind, revisionId)
      element.replaceChild(wrapped, child)
      return
    }
    applyRevisionToRuns(child, kind, revisionId)
  })
}

const createTextRun = (
  doc: Document,
  text: string,
  kind?: RevisionKind,
  revisionId?: number,
  prototypeRun?: Element | null
): Element => {
  const run = prototypeRun ? cloneElement(prototypeRun) : doc.createElementNS(WORD_NS, 'w:r')
  clearChildren(run)
  const rPr = prototypeRun ? firstChildElement(prototypeRun, 'rPr') : null
  if (rPr) {
    run.appendChild(cloneElement(rPr))
  }

  const parts = String(text || '').split('\n')
  parts.forEach((part, index) => {
    if (index > 0) {
      run.appendChild(doc.createElementNS(WORD_NS, 'w:br'))
    }
    const textNode = doc.createElementNS(WORD_NS, 'w:t')
    textNode.setAttribute('xml:space', 'preserve')
    textNode.appendChild(doc.createTextNode(part))
    run.appendChild(textNode)
  })

  if (!kind || revisionId === undefined) return run
  return wrapRunWithRevision(run, kind, revisionId)
}

const createParagraphFromSpec = (
  doc: Document,
  spec: DocxParagraphSpec,
  kind?: RevisionKind,
  revisionId?: number
): Element => {
  const paragraph = doc.createElementNS(WORD_NS, 'w:p')
  if (spec.style) {
    const pPr = doc.createElementNS(WORD_NS, 'w:pPr')
    const pStyle = doc.createElementNS(WORD_NS, 'w:pStyle')
    setWordAttribute(pStyle, 'val', spec.style)
    pPr.appendChild(pStyle)
    paragraph.appendChild(pPr)
  }

  const runs = spec.runs.length > 0 ? spec.runs : [{ text: '' }]
  runs.forEach((runSpec) => {
    const run = doc.createElementNS(WORD_NS, 'w:r')
    const rPr = doc.createElementNS(WORD_NS, 'w:rPr')
    if (runSpec.bold) rPr.appendChild(doc.createElementNS(WORD_NS, 'w:b'))
    if (runSpec.italic) rPr.appendChild(doc.createElementNS(WORD_NS, 'w:i'))
    if (runSpec.underline) rPr.appendChild(doc.createElementNS(WORD_NS, 'w:u'))
    if (runSpec.color) {
      const color = doc.createElementNS(WORD_NS, 'w:color')
      setWordAttribute(color, 'val', String(runSpec.color).replace(/^#/, '').toUpperCase())
      rPr.appendChild(color)
    }
    if (rPr.childNodes.length > 0) run.appendChild(rPr)
    paragraph.appendChild(
      createTextRun(doc, String(runSpec.text || ''), kind, revisionId, run)
    )
  })

  return paragraph
}

const createTableFromSpec = (
  doc: Document,
  spec: DocxTableSpec,
  kind?: RevisionKind,
  revisionId?: number
): Element => {
  const table = doc.createElementNS(WORD_NS, 'w:tbl')
  const columnCount = Math.max(1, ...spec.rows.map((row) => row.length))
  const tableWidth = 9072
  const columnWidth = Math.max(720, Math.floor(tableWidth / columnCount))

  const tblPr = doc.createElementNS(WORD_NS, 'w:tblPr')
  const tblW = doc.createElementNS(WORD_NS, 'w:tblW')
  const tblLayout = doc.createElementNS(WORD_NS, 'w:tblLayout')
  const tblLook = doc.createElementNS(WORD_NS, 'w:tblLook')
  setWordAttribute(tblW, 'w', String(tableWidth))
  setWordAttribute(tblW, 'type', 'dxa')
  setWordAttribute(tblLayout, 'type', 'fixed')
  setWordAttribute(tblLook, 'firstRow', '1')
  setWordAttribute(tblLook, 'lastRow', '0')
  setWordAttribute(tblLook, 'firstColumn', '1')
  setWordAttribute(tblLook, 'lastColumn', '0')
  setWordAttribute(tblLook, 'noHBand', '0')
  setWordAttribute(tblLook, 'noVBand', '1')
  tblPr.appendChild(tblW)
  tblPr.appendChild(tblLayout)
  tblPr.appendChild(tblLook)
  table.appendChild(tblPr)

  const tblGrid = doc.createElementNS(WORD_NS, 'w:tblGrid')
  for (let index = 0; index < columnCount; index += 1) {
    const gridCol = doc.createElementNS(WORD_NS, 'w:gridCol')
    setWordAttribute(gridCol, 'w', String(columnWidth))
    tblGrid.appendChild(gridCol)
  }
  table.appendChild(tblGrid)

  spec.rows.forEach((rowSpec) => {
    const row = doc.createElementNS(WORD_NS, 'w:tr')
    rowSpec.forEach((cellSpec) => {
      const cell = doc.createElementNS(WORD_NS, 'w:tc')
      const tcPr = doc.createElementNS(WORD_NS, 'w:tcPr')
      const tcW = doc.createElementNS(WORD_NS, 'w:tcW')
      setWordAttribute(tcW, 'w', String(columnWidth))
      setWordAttribute(tcW, 'type', 'dxa')
      tcPr.appendChild(tcW)
      cell.appendChild(tcPr)
      const paragraphs =
        cellSpec.paragraphs.length > 0
          ? cellSpec.paragraphs
          : [{ kind: 'paragraph' as const, runs: [{ text: '' }] }]
      paragraphs.forEach((paragraphSpec) => {
        cell.appendChild(createParagraphFromSpec(doc, paragraphSpec, kind, revisionId))
      })
      row.appendChild(cell)
    })
    table.appendChild(row)
  })
  return table
}

const createBlockFromSpec = (
  doc: Document,
  spec: DocxBlockSpec,
  kind?: RevisionKind,
  revisionId?: number
): Element => {
  return spec.kind === 'paragraph'
    ? createParagraphFromSpec(doc, spec, kind, revisionId)
    : createTableFromSpec(doc, spec, kind, revisionId)
}

const buildReplacementParagraphs = (node: IndexedNode, text: string): DocxParagraphSpec[] => {
  if (node.kind === 'paragraph') {
    const spec = paragraphNodeToSpec(node.node)
    return [
      {
        kind: 'paragraph',
        style: spec.style,
        runs: [{ text }]
      }
    ]
  }

  if (node.kind === 'table_cell') {
    const prototypeParagraph = childElements(node.node, 'p')[0]
    const style = prototypeParagraph ? paragraphNodeToSpec(prototypeParagraph).style : 'Normal'
    const lines = text.split('\n')
    return lines.length > 0
      ? lines.map((line) => ({
          kind: 'paragraph' as const,
          style,
          runs: [{ text: line }]
        }))
      : [{ kind: 'paragraph', style, runs: [{ text: '' }] }]
  }

  return [{ kind: 'paragraph', style: 'Normal', runs: [{ text }] }]
}

const insertBookmarkIntoParagraph = (
  paragraph: Element,
  anchorName: string,
  bookmarkId: number
): void => {
  const doc = paragraph.ownerDocument
  const bookmarkStart = doc.createElementNS(WORD_NS, 'w:bookmarkStart')
  const bookmarkEnd = doc.createElementNS(WORD_NS, 'w:bookmarkEnd')
  setWordAttribute(bookmarkStart, 'id', String(bookmarkId))
  setWordAttribute(bookmarkStart, 'name', anchorName)
  setWordAttribute(bookmarkEnd, 'id', String(bookmarkId))

  const pPr = firstChildElement(paragraph, 'pPr')
  const insertRef = pPr?.nextSibling || paragraph.firstChild
  paragraph.insertBefore(bookmarkStart, insertRef)
  paragraph.appendChild(bookmarkEnd)
}

const attachAnchor = (element: Element, anchorName: string, bookmarkId: number): void => {
  if (element.localName === 'p') {
    insertBookmarkIntoParagraph(element, anchorName, bookmarkId)
    return
  }

  const paragraph = descendantElements(element, 'p')[0]
  if (paragraph) {
    insertBookmarkIntoParagraph(paragraph, anchorName, bookmarkId)
  }
}

const replaceNodeWithMany = (target: Element, replacements: Element[]): void => {
  const parent = target.parentNode
  if (!parent) return
  replacements.forEach((replacement) => {
    parent.insertBefore(replacement, target)
  })
  parent.removeChild(target)
}

const insertAdjacentNodes = (
  target: Element,
  replacements: Element[],
  position: 'before' | 'after'
): void => {
  const parent = target.parentNode
  if (!parent) return
  if (position === 'before') {
    replacements.forEach((replacement) => parent.insertBefore(replacement, target))
    return
  }

  let reference = target.nextSibling
  replacements.forEach((replacement) => {
    parent.insertBefore(replacement, reference)
  })
}

const createDeletedClone = (node: IndexedNode, revisionId: number): Element => {
  const cloned = cloneElement(node.node)
  applyRevisionToRuns(cloned, 'deleted', revisionId)
  return cloned
}

const getWordAttribute = (node: Element, localName: string): string =>
  node.getAttribute(`w:${localName}`) || node.getAttribute(localName) || ''

const readConfirmManifest = async (manifestArtifactPath: string): Promise<DocxConfirmManifest> => {
  const raw = await fs.readFile(manifestArtifactPath, 'utf8')
  let parsed: JsonValue
  try {
    parsed = JSON.parse(raw) as JsonValue
  } catch {
    throw new Error('confirm_copy_manifest_invalid')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('confirm_copy_manifest_invalid')
  }

  const candidate = parsed as Partial<DocxConfirmManifest>
  if (
    candidate.version !== DOCX_CONFIRM_MANIFEST_VERSION ||
    typeof candidate.review_id !== 'string' ||
    !candidate.review_id.trim() ||
    !Array.isArray(candidate.changes)
  ) {
    throw new Error('confirm_copy_manifest_invalid')
  }

  const seenAnchors = new Set<string>()
  for (const change of candidate.changes) {
    if (!change || typeof change !== 'object' || Array.isArray(change)) {
      throw new Error('confirm_copy_manifest_invalid')
    }
    const anchorName =
      'anchor_name' in change && typeof change.anchor_name === 'string'
        ? change.anchor_name.trim()
        : ''
    if (!anchorName || !anchorName.startsWith(DOCX_CONFIRM_ANCHOR_PREFIX)) {
      throw new Error('confirm_copy_manifest_invalid')
    }
    if (seenAnchors.has(anchorName)) {
      throw new Error('confirm_copy_manifest_invalid')
    }
    seenAnchors.add(anchorName)
  }

  if (candidate.change_count !== candidate.changes.length) {
    throw new Error('confirm_copy_manifest_invalid')
  }

  return {
    ...candidate,
    review_id: candidate.review_id,
    changes: candidate.changes as DocxConfirmManifestChange[]
  } as DocxConfirmManifest
}

const validateConfirmCopyStructure = (
  root: Element,
  manifest: DocxConfirmManifest
): Set<string> => {
  const expectedAnchors = new Set(manifest.changes.map((change) => change.anchor_name))
  const anchorCounts = new Map<string, number>()
  const bookmarkIds = new Set<string>()

  const visit = (node: Element): void => {
    const children = Array.from({ length: node.childNodes.length })
      .map((_, index) => node.childNodes.item(index))
      .filter(Boolean)
    children.forEach((child) => {
      if (!isElementNode(child)) return

      if (child.localName === 'bookmarkStart') {
        const bookmarkName = getWordAttribute(child, 'name')
        if (bookmarkName.startsWith(DOCX_CONFIRM_ANCHOR_PREFIX)) {
          if (!expectedAnchors.has(bookmarkName)) {
            throw new Error('confirm_copy_manifest_anchor_mismatch')
          }
          anchorCounts.set(bookmarkName, (anchorCounts.get(bookmarkName) || 0) + 1)
          const bookmarkId = getWordAttribute(child, 'id')
          if (bookmarkId) bookmarkIds.add(bookmarkId)
        }
      }

      if (child.localName === 'ins' || child.localName === 'del') {
        const author = getWordAttribute(child, 'author')
        if (author !== SYSTEM_AUTHOR) {
          throw new Error('confirm_copy_external_revisions')
        }
      }

      visit(child)
    })
  }

  visit(root)

  for (const anchorName of expectedAnchors) {
    if (anchorCounts.get(anchorName) !== 1) {
      throw new Error('confirm_copy_manifest_anchor_mismatch')
    }
  }

  return bookmarkIds
}

const removeSystemBookmarkMarkers = (root: Element, bookmarkIds: Set<string>): void => {
  const children = Array.from({ length: root.childNodes.length })
    .map((_, index) => root.childNodes.item(index))
    .filter(Boolean)
  children.forEach((child) => {
    if (!isElementNode(child)) return
    const bookmarkName = getWordAttribute(child, 'name')
    const bookmarkId = getWordAttribute(child, 'id')
    if (
      (child.localName === 'bookmarkStart' &&
        bookmarkName.startsWith(DOCX_CONFIRM_ANCHOR_PREFIX) &&
        bookmarkIds.has(bookmarkId)) ||
      (child.localName === 'bookmarkEnd' && bookmarkIds.has(bookmarkId))
    ) {
      root.removeChild(child)
      return
    }
    removeSystemBookmarkMarkers(child, bookmarkIds)
  })
}

const unwrapSystemRevisions = (root: Element): void => {
  void root
}

const hasMeaningfulContent = (element: Element): boolean => {
  if (element.localName === 'tbl') {
    return childElements(element, 'tr').some((row) =>
      childElements(row, 'tc').some((cell) => hasMeaningfulContent(cell))
    )
  }
  if (descendantElements(element, 'drawing').length > 0 || descendantElements(element, 'pict').length > 0) {
    return true
  }
  return collectText(element).trim().length > 0
}

const pruneEmptyStructure = (root: Element): void => {
  const children = Array.from({ length: root.childNodes.length })
    .map((_, index) => root.childNodes.item(index))
    .filter(Boolean)
  children.forEach((child) => {
    if (!isElementNode(child)) return
    pruneEmptyStructure(child)
    if (child.localName === 'p' && !hasMeaningfulContent(child)) {
      root.removeChild(child)
      return
    }
    if (child.localName === 'tbl' && !hasMeaningfulContent(child)) {
      root.removeChild(child)
      return
    }
  })

  if (root.localName === 'tc' && childElements(root, 'p').length === 0 && childElements(root, 'tbl').length === 0) {
    root.appendChild(root.ownerDocument.createElementNS(WORD_NS, 'w:p'))
  }
}

const applyConfirmChange = (
  documentDom: Document,
  change: RunDraftChangeSeed,
  bookmarkId: number,
  revisionId: number
): void => {
  const index = buildBlockIndex(documentDom)
  const blockId =
    typeof change.locator.blockId === 'string' ? String(change.locator.blockId) : undefined
  if (!blockId) return
  const target = index.nodesById.get(blockId)
  if (!target) return

  const op = change.docxOp
  if (op.type === 'replace_block') {
    const deleted = createDeletedClone(target, revisionId)
    const inserted = createBlockFromSpec(documentDom, op.content, 'inserted', revisionId + 1)
    attachAnchor(deleted, change.anchorName, bookmarkId)
    replaceNodeWithMany(target.node, [deleted, inserted])
    return
  }

  if (op.type === 'delete_block') {
    const deleted = createDeletedClone(target, revisionId)
    attachAnchor(deleted, change.anchorName, bookmarkId)
    replaceNodeWithMany(target.node, [deleted])
    return
  }

  if (op.type === 'insert_before' || op.type === 'insert_after') {
    const insertedNodes = op.content.map((spec) =>
      createBlockFromSpec(documentDom, spec, 'inserted', revisionId)
    )
    if (insertedNodes[0]) attachAnchor(insertedNodes[0], change.anchorName, bookmarkId)
    insertAdjacentNodes(target.node, insertedNodes, op.type === 'insert_before' ? 'before' : 'after')
    return
  }

  if (op.type === 'update_table_cell') {
    if (target.kind !== 'table_cell') return
    const cell = target.node
    const tcPr = firstChildElement(cell, 'tcPr')
    const existingParagraphs = childElements(cell, 'p').map((paragraph) => cloneElement(paragraph))
    const deletedParagraphs = existingParagraphs.map((paragraph) => {
      applyRevisionToRuns(paragraph, 'deleted', revisionId)
      return paragraph
    })
    const insertedParagraphs = op.content.map((paragraphSpec) =>
      createParagraphFromSpec(documentDom, paragraphSpec, 'inserted', revisionId + 1)
    )
    clearChildren(cell)
    if (tcPr) cell.appendChild(tcPr)
    deletedParagraphs.forEach((paragraph) => cell.appendChild(paragraph))
    insertedParagraphs.forEach((paragraph) => cell.appendChild(paragraph))
    const anchorTarget = deletedParagraphs[0] || insertedParagraphs[0]
    if (anchorTarget) attachAnchor(anchorTarget, change.anchorName, bookmarkId)
    return
  }

  if (op.type !== 'replace_text') return

  if (target.kind === 'paragraph') {
    const deleted = createDeletedClone(target, revisionId)
    const replacementParagraph = createParagraphFromSpec(
      documentDom,
      buildReplacementParagraphs(target, change.afterText)[0],
      'inserted',
      revisionId + 1
    )
    attachAnchor(deleted, change.anchorName, bookmarkId)
    replaceNodeWithMany(target.node, [deleted, replacementParagraph])
    return
  }

  if (target.kind === 'table_cell') {
    const cell = target.node
    const tcPr = firstChildElement(cell, 'tcPr')
    const existingParagraphs = childElements(cell, 'p').map((paragraph) => cloneElement(paragraph))
    const deletedParagraphs = existingParagraphs.map((paragraph) => {
      applyRevisionToRuns(paragraph, 'deleted', revisionId)
      return paragraph
    })
    const insertedParagraphs = buildReplacementParagraphs(target, change.afterText).map(
      (paragraphSpec) =>
        createParagraphFromSpec(documentDom, paragraphSpec, 'inserted', revisionId + 1)
    )
    clearChildren(cell)
    if (tcPr) cell.appendChild(tcPr)
    deletedParagraphs.forEach((paragraph) => cell.appendChild(paragraph))
    insertedParagraphs.forEach((paragraph) => cell.appendChild(paragraph))
    const anchorTarget = deletedParagraphs[0] || insertedParagraphs[0]
    if (anchorTarget) attachAnchor(anchorTarget, change.anchorName, bookmarkId)
  }
}

const buildManifestChanges = (changes: RunDraftChangeSeed[]): DocxConfirmManifestChange[] =>
  changes.map((change) => ({
    change_id: change.id,
    order_index: change.orderIndex,
    change_kind: change.changeKind,
    anchor_name: change.anchorName,
    block_id: typeof change.locator.blockId === 'string' ? change.locator.blockId : undefined,
    action: typeof change.locator.action === 'string' ? change.locator.action : undefined
  }))

export const materializeDocxConfirmCopy = async (input: {
  baseBuffer: Buffer
  confirmArtifactPath: string
  manifestArtifactPath: string
  reviewId: string
  sourcePath: string
  sourceName: string
  latestDraftSnapshotId: string
  sourceVersion: DraftSourceVersion
  changes: RunDraftChangeSeed[]
  createdAt: number
}): Promise<DocxConfirmManifest> => {
  const bundle = await loadDocxBundle(input.baseBuffer)
  const orderedChanges = input.changes.slice().sort((left, right) => left.orderIndex - right.orderIndex)
  orderedChanges.forEach((change, index) => {
    applyConfirmChange(
      bundle.documentDom,
      change,
      DOCX_CONFIRM_BOOKMARK_ID_BASE + index,
      DOCX_CONFIRM_BOOKMARK_ID_BASE + index * 2
    )
  })

  const buffer = await writeDocumentXml(bundle.zip, bundle.documentDom)
  await assertValidDocxBuffer(buffer, 'confirm_copy_invalid_generated')
  const manifest: DocxConfirmManifest = {
    version: DOCX_CONFIRM_MANIFEST_VERSION,
    review_id: input.reviewId,
    source_path: input.sourcePath,
    source_name: input.sourceName,
    source_version: input.sourceVersion,
    latest_draft_snapshot_id: input.latestDraftSnapshotId,
    created_at: input.createdAt,
    change_count: orderedChanges.length,
    changes: buildManifestChanges(orderedChanges)
  }

  await Promise.all([
    ensureDirForFile(input.confirmArtifactPath),
    ensureDirForFile(input.manifestArtifactPath)
  ])
  await Promise.all([
    fs.writeFile(input.confirmArtifactPath, buffer),
    fs.writeFile(input.manifestArtifactPath, JSON.stringify(manifest, null, 2), 'utf8')
  ])
  return manifest
}

export const normalizeDocxConfirmCopy = async (input: {
  confirmArtifactPath: string
  manifestArtifactPath: string
  outPath: string
}): Promise<void> => {
  const manifest = await readConfirmManifest(input.manifestArtifactPath)
  const buffer = await fs.readFile(input.confirmArtifactPath)
  const bundle = await loadDocxBundle(buffer)
  const bookmarkIds = validateConfirmCopyStructure(bundle.documentDom.documentElement, manifest)
  removeSystemBookmarkMarkers(bundle.documentDom.documentElement, bookmarkIds)
  unwrapSystemRevisions(bundle.documentDom.documentElement)
  pruneEmptyStructure(bundle.documentDom.documentElement)
  const normalizedBuffer = await writeDocumentXml(bundle.zip, bundle.documentDom)
  await assertValidDocxBuffer(normalizedBuffer, 'confirm_copy_invalid_normalized')
  await ensureDirForFile(input.outPath)
  await fs.writeFile(input.outPath, normalizedBuffer)
}
