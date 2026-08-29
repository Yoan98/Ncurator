import { createHash } from 'node:crypto'
import { paragraphNodeToSpec } from './nodeIndex'
import { childElements } from './dom'
import type { IndexedNode } from './types'
import type { DocxNodeSpec, DocxParagraphSpec, DocxTableSpec, DocxTextRunSpec } from '../../types'
import { normalizeDocxHexColor } from '../../utils/color'

const normalizeRun = (run: DocxTextRunSpec): DocxTextRunSpec => ({
  text: String(run.text || '').replace(/\r\n/g, '\n'),
  bold: run.bold ? true : undefined,
  italic: run.italic ? true : undefined,
  underline: run.underline ? true : undefined,
  color: run.color ? normalizeDocxHexColor(run.color) : undefined
})

export const normalizeParagraphSpec = (spec: DocxParagraphSpec): DocxParagraphSpec => ({
  kind: 'paragraph',
  style: String(spec.style || 'Normal'),
  runs: spec.runs
    .map((run) => normalizeRun(run))
    .filter((run) => run.text.length > 0 || run.bold || run.italic || run.underline || run.color)
    .map((run) => ({ ...run })) || [{ text: '' }]
})

const normalizeTableSpec = (spec: DocxTableSpec): DocxTableSpec => ({
  kind: 'table',
  rows: spec.rows.map((row) =>
    row.map((cell) => ({
      paragraphs:
        cell.paragraphs.length > 0
          ? cell.paragraphs.map((paragraph) => normalizeParagraphSpec(paragraph))
          : [{ kind: 'paragraph', style: 'Normal', runs: [{ text: '' }] }]
    }))
  )
})

export const normalizeNodeSpec = (spec: DocxNodeSpec): DocxNodeSpec => {
  if (spec.kind === 'paragraph') return normalizeParagraphSpec(spec)
  return normalizeTableSpec(spec)
}

export const tableNodeToSpec = (node: Element): DocxTableSpec => {
  const rows = childElements(node, 'tr').map((rowNode) => {
    return childElements(rowNode, 'tc').map((cellNode) => {
      const paragraphs = childElements(cellNode, 'p')
      const paragraphSpecs =
        paragraphs.length > 0
          ? paragraphs.map((paragraph) => paragraphNodeToSpec(paragraph))
          : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
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

export const nodeToNodeSpec = (node: IndexedNode): DocxNodeSpec => {
  if (node.kind === 'paragraph') return paragraphNodeToSpec(node.node)
  if (node.kind === 'table') return tableNodeToSpec(node.node)

  const paragraphs = childElements(node.node, 'p')
  return {
    kind: 'paragraph',
    style: paragraphs[0] ? paragraphNodeToSpec(paragraphs[0]).style : 'Normal',
    runs: [
      {
        text: paragraphs
          .map((paragraph) =>
            paragraphNodeToSpec(paragraph)
              .runs.map((run) => run.text)
              .join('')
          )
          .join('\n')
      }
    ]
  }
}

export const paragraphSpecText = (spec: DocxParagraphSpec): string =>
  spec.runs.map((run) => run.text).join('')

export const nodeSpecText = (spec: DocxNodeSpec): string => {
  if (spec.kind === 'paragraph') return paragraphSpecText(spec)
  return spec.rows
    .map((row) =>
      row
        .map((cell) => cell.paragraphs.map((paragraph) => paragraphSpecText(paragraph)).join('\n'))
        .join(' | ')
    )
    .join('\n')
}

export const normalizeDocxText = (value: string): string =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

export const buildParagraphFormattingSignature = (spec: DocxParagraphSpec): string => {
  const normalized = normalizeParagraphSpec(spec)
  const segments: string[] = []

  normalized.runs.forEach((run) => {
    if (!run.text) return
    const key = [
      run.bold ? 'b1' : 'b0',
      run.italic ? 'i1' : 'i0',
      run.underline ? 'u1' : 'u0',
      `c:${run.color || ''}`
    ].join('|')
    if (segments[segments.length - 1] !== key) {
      segments.push(key)
    }
  })

  return `${normalized.style || 'Normal'}::${segments.join(',')}`
}

export const buildNodeStructureSignature = (spec: DocxNodeSpec): string => {
  if (spec.kind === 'paragraph') {
    return `paragraph:${buildParagraphFormattingSignature(spec)}`
  }

  const normalized = normalizeTableSpec(spec)
  const rowShape = normalized.rows.map((row) => row.length).join(',')
  const cellShape = normalized.rows
    .flatMap((row) => row.map((cell) => cell.paragraphs.length))
    .join(',')
  return `table:${normalized.rows.length}:${rowShape}:${cellShape}`
}

export const buildNodeExactSignature = (spec: DocxNodeSpec): string =>
  createHash('sha1')
    .update(JSON.stringify(normalizeNodeSpec(spec)))
    .digest('hex')
