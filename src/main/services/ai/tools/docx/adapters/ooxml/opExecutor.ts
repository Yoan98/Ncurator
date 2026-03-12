import { randomUUID } from 'node:crypto'
import { XMLSerializer } from '@xmldom/xmldom'
import type JSZip from 'jszip'
import {
  Paragraph,
  patchDocument,
  PatchType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType
} from 'docx'
import { injectPatchTag } from './anchorInjector'
import {
  buildBlockIndex,
  loadDocxBundle,
  extractBlockText,
  paragraphNodeToSpec,
  type BlockIndex,
  type IndexedNode
} from './blockIndex'
import type {
  DocxBlockSpec,
  DocxChangedBlock,
  DocxOp,
  DocxParagraphSpec,
  DocxTableSpec
} from '../../types'

type ApplyOpsResult = {
  buffer: Buffer
  changedBlocks: DocxChangedBlock[]
  warnings: string[]
}

const isElementNode = (value: Node | null): value is Element => {
  return value !== null && value.nodeType === 1
}

const collectNodeText = (node: Element): string => {
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
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index)
      if (child) stack.push(child)
    }
  }
  return text
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

const safeColor = (input: string | undefined): string | undefined => {
  const value = String(input || '').trim()
  if (!value) return undefined
  const normalized = value.replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return undefined
  return normalized.toUpperCase()
}

const paragraphFromSpec = (spec: DocxParagraphSpec): Paragraph => {
  const runs = spec.runs
    .map((run) => {
      const text = String(run.text || '')
      if (!text) return null
      return new TextRun({
        text,
        bold: Boolean(run.bold),
        italics: Boolean(run.italic),
        color: safeColor(run.color),
        underline: run.underline ? { type: UnderlineType.SINGLE } : undefined
      })
    })
    .filter((run): run is TextRun => Boolean(run))

  return new Paragraph({
    style: spec.style || undefined,
    children: runs.length > 0 ? runs : [new TextRun('')]
  })
}

const tableFromSpec = (spec: DocxTableSpec): Table => {
  return new Table({
    rows: spec.rows.map(
      (row) =>
        new TableRow({
          children: row.map((cell) => {
            const paragraphs = cell.paragraphs.map((paragraph) => paragraphFromSpec(paragraph))
            return new TableCell({
              children: paragraphs.length > 0 ? paragraphs : [new Paragraph('')]
            })
          })
        })
    )
  })
}

const specToDocxChildren = (specs: DocxBlockSpec[]): Array<Paragraph | Table> => {
  return specs.map((spec) => (spec.kind === 'paragraph' ? paragraphFromSpec(spec) : tableFromSpec(spec)))
}

const tableNodeToSpec = (node: Element): DocxTableSpec => {
  const rows = childElements(node, 'tr').map((rowNode) => {
    return childElements(rowNode, 'tc').map((cellNode) => {
      const paragraphs = childElements(cellNode, 'p')
      const paragraphSpecs = paragraphs.length > 0 ? paragraphs.map((paragraph) => paragraphNodeToSpec(paragraph)) : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
      return {
        paragraphs: paragraphSpecs
      }
    })
  })
  return {
    kind: 'table',
    rows
  }
}

const nodeToBlockSpec = (node: IndexedNode): DocxBlockSpec => {
  if (node.kind === 'paragraph') return paragraphNodeToSpec(node.node)
  if (node.kind === 'table') return tableNodeToSpec(node.node)

  const paragraphs = childElements(node.node, 'p')
  return {
    kind: 'paragraph',
    style: paragraphs[0] ? paragraphNodeToSpec(paragraphs[0]).style : 'Normal',
    runs: [{ text: paragraphs.map((paragraph) => paragraphNodeToSpec(paragraph).runs.map((run) => run.text).join('')).join('\n') }]
  }
}

const blockSpecText = (spec: DocxBlockSpec): string => {
  if (spec.kind === 'paragraph') return spec.runs.map((run) => run.text).join('')
  return spec.rows
    .map((row) =>
      row.map((cell) => cell.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')).join(' | ')
    )
    .join('\n')
}

const patchWithTag = async (input: {
  buffer: Buffer
  blockId: string
  children: Array<Paragraph | Table>
}): Promise<Buffer> => {
  const tag = `patch_${randomUUID().replace(/-/g, '')}`
  const injected = await injectPatchTag({
    buffer: input.buffer,
    blockId: input.blockId,
    tagName: tag
  })
  return await patchDocument({
    outputType: 'nodebuffer',
    data: injected,
    keepOriginalStyles: true,
    patches: {
      [tag]: {
        type: PatchType.DOCUMENT,
        children: input.children
      }
    }
  })
}

const loadIndex = async (buffer: Buffer): Promise<BlockIndex> => {
  const bundle = await loadDocxBundle(buffer)
  return buildBlockIndex(bundle.documentDom)
}

const writeDocumentXml = async (input: { zip: JSZip; doc: Document }): Promise<Buffer> => {
  const xml = new XMLSerializer().serializeToString(input.doc)
  input.zip.file('word/document.xml', xml)
  return await input.zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
}

const textElementsInNode = (node: Element): Element[] => {
  const out: Element[] = []
  const stack: Node[] = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || !isElementNode(current)) continue
    if (current.localName === 't') {
      out.push(current)
      continue
    }
    const children = current.childNodes
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children.item(index)
      if (child) stack.push(child)
    }
  }
  return out
}

const textElementValue = (node: Element): string => {
  return node.textContent || ''
}

const setTextElementValue = (node: Element, value: string) => {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
  node.appendChild(node.ownerDocument.createTextNode(value))
}

const replaceSingleOccurrenceInTextElements = (
  textElements: Element[],
  query: string,
  replacement: string,
  fromIndex: number
): number => {
  const combined = textElements.map((node) => textElementValue(node)).join('')
  const start = combined.indexOf(query, Math.max(0, fromIndex))
  if (start < 0) return -1

  const end = start + query.length
  let cursor = 0
  let inserted = false

  for (const textElement of textElements) {
    const text = textElementValue(textElement)
    const nodeStart = cursor
    const nodeEnd = cursor + text.length
    cursor = nodeEnd

    if (nodeEnd <= start || nodeStart >= end) continue

    const beforePart = nodeStart < start ? text.slice(0, start - nodeStart) : ''
    const afterPart = nodeEnd > end ? text.slice(end - nodeStart) : ''
    const nextText = `${beforePart}${inserted ? '' : replacement}${afterPart}`
    setTextElementValue(textElement, nextText)
    inserted = true
  }

  return start
}

const replaceTextInParagraphNode = (
  paragraph: Element,
  query: string,
  replacement: string,
  replaceAll: boolean
): boolean => {
  let changed = false
  let searchFrom = 0
  while (true) {
    const textElements = textElementsInNode(paragraph)
    if (textElements.length === 0) return changed
    const replacedAt = replaceSingleOccurrenceInTextElements(
      textElements,
      query,
      replacement,
      searchFrom
    )
    if (replacedAt < 0) return changed
    changed = true
    if (!replaceAll) return changed
    searchFrom = replacedAt + replacement.length
  }
}

const applyStructuralOp = async (input: {
  buffer: Buffer
  op:
    | Extract<DocxOp, { type: 'replace_block' }>
    | Extract<DocxOp, { type: 'insert_after' | 'insert_before' }>
    | Extract<DocxOp, { type: 'delete_block' }>
    | Extract<DocxOp, { type: 'update_table_cell' }>
}): Promise<{ buffer: Buffer; changed: DocxChangedBlock | null; warning?: string }> => {
  const index = await loadIndex(input.buffer)
  const op = input.op

  if (op.type === 'replace_block') {
    const beforeText = extractBlockText(index, op.blockId)
    if (!beforeText && !index.nodesById.has(op.blockId)) {
      return {
        buffer: input.buffer,
        changed: null,
        warning: `replace_block skipped: block not found (${op.blockId})`
      }
    }
    const next = await patchWithTag({
      buffer: input.buffer,
      blockId: op.blockId,
      children: specToDocxChildren([op.content])
    })
    return {
      buffer: next,
      changed: {
        action: 'replace_block',
        blockId: op.blockId,
        beforeText,
        afterText: blockSpecText(op.content)
      }
    }
  }

  if (op.type === 'delete_block') {
    const beforeText = extractBlockText(index, op.blockId)
    if (!beforeText && !index.nodesById.has(op.blockId)) {
      return {
        buffer: input.buffer,
        changed: null,
        warning: `delete_block skipped: block not found (${op.blockId})`
      }
    }
    const next = await patchWithTag({
      buffer: input.buffer,
      blockId: op.blockId,
      children: []
    })
    return {
      buffer: next,
      changed: {
        action: 'delete_block',
        blockId: op.blockId,
        beforeText,
        afterText: ''
      }
    }
  }

  if (op.type === 'update_table_cell') {
    const node = index.nodesById.get(op.blockId)
    if (!node || node.kind !== 'table_cell') {
      return {
        buffer: input.buffer,
        changed: null,
        warning: `update_table_cell skipped: table cell not found (${op.blockId})`
      }
    }
    const beforeText = extractBlockText(index, op.blockId)
    const next = await patchWithTag({
      buffer: input.buffer,
      blockId: op.blockId,
      children: op.content.map((paragraph) => paragraphFromSpec(paragraph))
    })
    const afterText = op.content.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
    return {
      buffer: next,
      changed: {
        action: 'update_table_cell',
        blockId: op.blockId,
        beforeText,
        afterText
      }
    }
  }

  const anchorId = op.anchorBlockId
  const anchor = index.nodesById.get(anchorId)
  if (!anchor || anchor.kind === 'table_cell') {
    return {
      buffer: input.buffer,
      changed: null,
      warning: `${op.type} skipped: anchor block not found (${anchorId})`
    }
  }
  const beforeText = extractBlockText(index, anchorId)
  const anchorSpec = nodeToBlockSpec(anchor)
  const mergedSpecs = op.type === 'insert_before' ? [...op.content, anchorSpec] : [anchorSpec, ...op.content]
  const next = await patchWithTag({
    buffer: input.buffer,
    blockId: anchorId,
    children: specToDocxChildren(mergedSpecs)
  })
  const insertedText = op.content.map((spec) => blockSpecText(spec)).join('\n')
  return {
    buffer: next,
    changed: {
      action: op.type,
      blockId: anchorId,
      beforeText,
      afterText: op.type === 'insert_before' ? `${insertedText}\n${beforeText}`.trim() : `${beforeText}\n${insertedText}`.trim()
    }
  }
}

const structuralOpTargetRank = (
  index: BlockIndex,
  op:
    | Extract<DocxOp, { type: 'replace_block' }>
    | Extract<DocxOp, { type: 'insert_after' | 'insert_before' }>
    | Extract<DocxOp, { type: 'delete_block' }>
    | Extract<DocxOp, { type: 'update_table_cell' }>
): number => {
  if (op.type === 'insert_after' || op.type === 'insert_before') {
    const node = index.nodesById.get(op.anchorBlockId)
    return typeof node?.bodyIndex === 'number' ? node.bodyIndex : -1
  }
  const node = index.nodesById.get(op.blockId)
  return typeof node?.bodyIndex === 'number' ? node.bodyIndex : -1
}

const applyReplaceTextOp = async (
  buffer: Buffer,
  op: Extract<DocxOp, { type: 'replace_text' }>
): Promise<{ buffer: Buffer; changedBlocks: DocxChangedBlock[]; warnings: string[] }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildBlockIndex(bundle.documentDom)
  const warnings: string[] = []
  const selected = Array.isArray(op.blockIds) && op.blockIds.length > 0 ? op.blockIds : index.outline.map((item) => item.blockId)
  const changedBlocks: DocxChangedBlock[] = []

  for (const blockId of selected) {
    const node = index.nodesById.get(blockId)
    if (!node) continue

    if (node.kind === 'paragraph') {
      const beforeText = extractBlockText(index, blockId)
      const changed = replaceTextInParagraphNode(
        node.node,
        op.query,
        op.replace,
        Boolean(op.replaceAll)
      )
      if (!changed) continue
      const afterText = collectNodeText(node.node)
      changedBlocks.push({
        action: 'replace_text',
        blockId,
        beforeText,
        afterText
      })
      continue
    }

    if (node.kind === 'table_cell') {
      const paragraphs = childElements(node.node, 'p')
      const before = extractBlockText(index, blockId)
      let changed = false
      for (const paragraph of paragraphs) {
        const paragraphChanged = replaceTextInParagraphNode(
          paragraph,
          op.query,
          op.replace,
          Boolean(op.replaceAll)
        )
        if (paragraphChanged) changed = true
      }
      if (!changed) continue
      const after = collectNodeText(node.node)
      changedBlocks.push({
        action: 'replace_text',
        blockId,
        beforeText: before,
        afterText: after
      })
    }
  }

  if (changedBlocks.length === 0) {
    warnings.push(`replace_text not found: ${op.query}`)
  }
  return {
    buffer: await writeDocumentXml({ zip: bundle.zip, doc: bundle.documentDom }),
    changedBlocks,
    warnings
  }
}

export const applyDocxOps = async (input: {
  buffer: Buffer
  ops: DocxOp[]
}): Promise<ApplyOpsResult> => {
  let workingBuffer = input.buffer
  const changedBlocks: DocxChangedBlock[] = []
  const warnings: string[] = []
  const originalIndex = await loadIndex(input.buffer)
  const orderedOps: DocxOp[] = []
  let segment: Array<{
    op:
      | Extract<DocxOp, { type: 'replace_block' }>
      | Extract<DocxOp, { type: 'insert_after' | 'insert_before' }>
      | Extract<DocxOp, { type: 'delete_block' }>
      | Extract<DocxOp, { type: 'update_table_cell' }>
    inputOrder: number
  }> = []

  const flushStructuralSegment = () => {
    if (segment.length === 0) return
    segment
      .slice()
      .sort((left, right) => {
        const leftRank = structuralOpTargetRank(originalIndex, left.op)
        const rightRank = structuralOpTargetRank(originalIndex, right.op)
        if (leftRank !== rightRank) return rightRank - leftRank
        return left.inputOrder - right.inputOrder
      })
      .forEach((entry) => {
        orderedOps.push(entry.op)
      })
    segment = []
  }

  input.ops.forEach((op, inputOrder) => {
    if (op.type === 'replace_text') {
      flushStructuralSegment()
      orderedOps.push(op)
      return
    }
    segment.push({ op, inputOrder })
  })
  flushStructuralSegment()

  for (const op of orderedOps) {
    if (op.type === 'replace_text') {
      const replaced = await applyReplaceTextOp(workingBuffer, op)
      workingBuffer = replaced.buffer
      changedBlocks.push(...replaced.changedBlocks)
      warnings.push(...replaced.warnings)
      continue
    }

    const applied = await applyStructuralOp({
      buffer: workingBuffer,
      op
    })
    workingBuffer = applied.buffer
    if (applied.changed) changedBlocks.push(applied.changed)
    if (applied.warning) warnings.push(applied.warning)
  }

  return {
    buffer: workingBuffer,
    changedBlocks,
    warnings
  }
}
