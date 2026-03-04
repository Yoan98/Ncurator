import { randomUUID } from 'node:crypto'
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
  extractBlockText,
  loadDocxBundle,
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

const replaceLiteral = (text: string, query: string, replacement: string, replaceAll: boolean): string => {
  if (!query) return text
  if (replaceAll) return text.split(query).join(replacement)
  const index = text.indexOf(query)
  if (index < 0) return text
  return `${text.slice(0, index)}${replacement}${text.slice(index + query.length)}`
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

const buildReplaceTextOps = async (
  buffer: Buffer,
  op: Extract<DocxOp, { type: 'replace_text' }>
): Promise<{ ops: DocxOp[]; warnings: string[] }> => {
  const index = await loadIndex(buffer)
  const warnings: string[] = []
  const selected = Array.isArray(op.blockIds) && op.blockIds.length > 0 ? op.blockIds : index.outline.map((item) => item.blockId)
  const out: DocxOp[] = []

  for (const blockId of selected) {
    const node = index.nodesById.get(blockId)
    if (!node) continue

    if (node.kind === 'paragraph') {
      const current = extractBlockText(index, blockId)
      const replaced = replaceLiteral(current, op.query, op.replace, Boolean(op.replaceAll))
      if (current === replaced) continue
      const spec = paragraphNodeToSpec(node.node)
      out.push({
        type: 'replace_block',
        blockId,
        content: {
          kind: 'paragraph',
          style: spec.style,
          runs: [{ text: replaced }]
        }
      })
      continue
    }

    if (node.kind === 'table_cell') {
      const paragraphs = childElements(node.node, 'p')
      const updated = paragraphs.map((paragraph) => {
        const spec = paragraphNodeToSpec(paragraph)
        const current = spec.runs.map((run) => run.text).join('')
        const replaced = replaceLiteral(current, op.query, op.replace, Boolean(op.replaceAll))
        return {
          ...spec,
          runs: [{ text: replaced }]
        }
      })
      const before = extractBlockText(index, blockId)
      const after = updated.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
      if (before === after) continue
      out.push({
        type: 'update_table_cell',
        blockId,
        content: updated
      })
    }
  }

  if (out.length === 0) {
    warnings.push(`replace_text not found: ${op.query}`)
  }
  return { ops: out, warnings }
}

export const applyDocxOps = async (input: {
  buffer: Buffer
  ops: DocxOp[]
}): Promise<ApplyOpsResult> => {
  let workingBuffer = input.buffer
  const changedBlocks: DocxChangedBlock[] = []
  const warnings: string[] = []

  for (const op of input.ops) {
    if (op.type === 'replace_text') {
      const generated = await buildReplaceTextOps(workingBuffer, op)
      warnings.push(...generated.warnings)
      for (const generatedOp of generated.ops) {
        if (generatedOp.type === 'replace_text') continue
        const applied = await applyStructuralOp({
          buffer: workingBuffer,
          op: generatedOp
        })
        workingBuffer = applied.buffer
        if (applied.changed) changedBlocks.push(applied.changed)
        if (applied.warning) warnings.push(applied.warning)
      }
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
