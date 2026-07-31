import { XMLSerializer } from '@xmldom/xmldom'
import type JSZip from 'jszip'
import type { DocxChangedBlock, DocxOp, DocxStylePatch } from '../../types'
import { buildBlockIndex, extractBlockText, loadDocxBundle } from './blockIndex'
import {
  createBlockFromNode,
  createNodeText,
  createRelationshipWriter,
  replaceCellContentFromNodes
} from './createNodeDom'
import { childElements, firstChildElement, isElementNode } from './dom'
import type { ApplyOpsResult, BlockIndex } from './types'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

type StructuralDocxOp =
  | Extract<DocxOp, { type: 'replace_block' }>
  | Extract<DocxOp, { type: 'insert_after' | 'insert_before' }>
  | Extract<DocxOp, { type: 'delete_block' }>
  | Extract<DocxOp, { type: 'update_table_cell' }>

const wordElement = (doc: Document, name: string): Element =>
  doc.createElementNS(WORD_NS, `w:${name}`)

const setWordAttr = (node: Element, name: string, value: string): void => {
  node.setAttributeNS(WORD_NS, `w:${name}`, value)
}

const setText = (node: Element, value: string): void => {
  while (node.firstChild) node.removeChild(node.firstChild)
  node.appendChild(node.ownerDocument.createTextNode(value))
  if (/^\s|\s$/.test(value)) node.setAttribute('xml:space', 'preserve')
  else node.removeAttribute('xml:space')
}

const writeDocumentXml = async (zip: JSZip, doc: Document): Promise<Buffer> => {
  zip.file('word/document.xml', new XMLSerializer().serializeToString(doc))
  return await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
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

const patchBorders = (properties: Element, name: string, value: unknown): void => {
  if (value === undefined) return
  removeProperty(properties, name)
  if (value === null) return
  const container = wordElement(properties.ownerDocument, name)
  const sideNames: Record<string, string> = {
    insideHorizontal: 'insideH',
    insideVertical: 'insideV'
  }
  Object.entries(value as Record<string, { style: string; color?: string; size?: number }>).forEach(
    ([side, border]) => {
      const node = wordElement(properties.ownerDocument, sideNames[side] || side)
      setWordAttr(node, 'val', border.style)
      if (border.color) setWordAttr(node, 'color', border.color)
      if (border.size !== undefined) setWordAttr(node, 'sz', String(Math.round(border.size * 8)))
      container.appendChild(node)
    }
  )
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
  setValProperty(rPr, 'color', patch.color)
  if (patch.highlight !== undefined) {
    removeProperty(rPr, 'shd')
    if (patch.highlight !== null) {
      const shading = wordElement(run.ownerDocument, 'shd')
      setWordAttr(shading, 'fill', patch.highlight)
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
  setValProperty(pPr, 'pStyle', patch.styleName)
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
      setWordAttr(shd, 'fill', patch.shading)
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

const validateVisualLoss = (index: BlockIndex, op: StructuralDocxOp): void => {
  if (op.type === 'insert_after' || op.type === 'insert_before' || op.allowVisualLoss) return
  const target = index.nodesById.get(op.blockId)
  if (!target) return
  const isDescendant = (candidate: Element): boolean => {
    let current: Node | null = candidate
    while (current) {
      if (current === target.node) return true
      current = current.parentNode
    }
    return false
  }
  const visualKinds = new Set<string>()
  index.visualsById.forEach((visual) => {
    const owner = index.nodesById.get(visual.blockId)
    if (visual.blockId === op.blockId || (owner && isDescendant(owner.node)))
      visualKinds.add(visual.kind)
  })
  if (visualKinds.size === 0) return
  const count = [...index.visualsById.values()].filter((visual) => {
    const owner = index.nodesById.get(visual.blockId)
    return visual.blockId === op.blockId || Boolean(owner && isDescendant(owner.node))
  }).length
  throw new Error(
    `visual loss blocked for ${op.blockId}: ${String(count)} visual(s), kinds: ${[...visualKinds].join(', ')}`
  )
}

const applyStructural = async (
  buffer: Buffer,
  op: StructuralDocxOp
): Promise<{ buffer: Buffer; changed?: DocxChangedBlock; warning?: string }> => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildBlockIndex(
    bundle.documentDom,
    bundle.relationshipTargets,
    bundle.relationshipTypes,
    bundle.relationshipTargetModes,
    bundle.availableRelationshipTargetIds
  )
  validateVisualLoss(index, op)
  const relationships = await createRelationshipWriter(bundle.zip)
  const id =
    op.type === 'insert_after' || op.type === 'insert_before' ? op.anchorBlockId : op.blockId
  const target = index.nodesById.get(id)
  if (!target) throw new Error(`${op.type} target not found: ${id}`)
  const beforeText = extractBlockText(index, id)
  if (op.type === 'replace_block') {
    const parent = target.node.parentNode
    if (!parent) throw new Error(`block has no parent: ${id}`)
    parent.replaceChild(
      createBlockFromNode(bundle.documentDom, op.content, relationships),
      target.node
    )
    await relationships.persist()
    return {
      buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
      changed: { action: op.type, blockId: id, beforeText, afterText: createNodeText(op.content) }
    }
  }
  if (op.type === 'delete_block') {
    target.node.parentNode?.removeChild(target.node)
    return {
      buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
      changed: { action: op.type, blockId: id, beforeText, afterText: '' }
    }
  }
  if (op.type === 'update_table_cell') {
    if (target.kind !== 'table_cell')
      throw new Error(`style target type mismatch: ${id} is not a table_cell`)
    replaceCellContentFromNodes(target.node, op.content, relationships)
    await relationships.persist()
    return {
      buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
      changed: {
        action: op.type,
        blockId: id,
        beforeText,
        afterText: op.content.map(createNodeText).join('\n')
      }
    }
  }
  if (target.kind === 'table_cell') throw new Error('insert_blocks anchor must be a body block')
  const parent = target.node.parentNode
  if (!parent) throw new Error(`anchor block has no parent: ${id}`)
  const reference = op.type === 'insert_before' ? target.node : target.node.nextSibling
  op.content.forEach((node) =>
    parent.insertBefore(createBlockFromNode(bundle.documentDom, node, relationships), reference)
  )
  await relationships.persist()
  const insertedText = op.content.map(createNodeText).join('\n')
  return {
    buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
    changed: {
      action: op.type,
      blockId: id,
      beforeText,
      afterText:
        op.type === 'insert_before'
          ? `${insertedText}\n${beforeText}`
          : `${beforeText}\n${insertedText}`
    }
  }
}

const selectedNodes = (index: BlockIndex, ids: string[] | undefined) => {
  if (ids?.length)
    return ids
      .map((id) => index.nodesById.get(id))
      .filter((node): node is NonNullable<typeof node> => Boolean(node))
  return index.bodyBlockIds
    .map((id) => index.nodesById.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
}

const applyReplaceText = async (buffer: Buffer, op: Extract<DocxOp, { type: 'replace_text' }>) => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildBlockIndex(
    bundle.documentDom,
    bundle.relationshipTargets,
    bundle.relationshipTypes,
    bundle.relationshipTargetModes,
    bundle.availableRelationshipTargetIds
  )
  const changedBlocks: DocxChangedBlock[] = []
  const seenParagraphs = new Set<Element>()
  selectedNodes(index, op.blockIds).forEach((node) => {
    const beforeText = extractBlockText(index, node.blockId)
    let changed = false
    directParagraphs(node.node).forEach((paragraph) => {
      if (seenParagraphs.has(paragraph)) return
      seenParagraphs.add(paragraph)
      textSegments(paragraph).forEach((segment) => {
        if (replaceInSegment(segment, op.query, op.replace)) changed = true
      })
    })
    if (changed)
      changedBlocks.push({
        action: 'replace_text',
        blockId: node.blockId,
        beforeText,
        afterText: node.node.textContent || ''
      })
  })
  if (changedBlocks.length === 0) throw new Error(`replace_text not found: ${op.query}`)
  return {
    buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
    changedBlocks,
    warnings: []
  }
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

const applyStyle = async (buffer: Buffer, op: Extract<DocxOp, { type: 'style' }>) => {
  const bundle = await loadDocxBundle(buffer)
  const index = buildBlockIndex(
    bundle.documentDom,
    bundle.relationshipTargets,
    bundle.relationshipTypes,
    bundle.relationshipTargetModes,
    bundle.availableRelationshipTargetIds
  )
  const changedBlocks: DocxChangedBlock[] = []
  if (op.target.type === 'text_match') {
    if (op.patch.kind !== 'run') throw new Error('style text_match only accepts a run patch')
    const target = op.target
    const patch = op.patch
    const seenParagraphs = new Set<Element>()
    selectedNodes(index, target.blockIds).forEach((node) => {
      const beforeText = extractBlockText(index, node.blockId)
      let changed = false
      directParagraphs(node.node).forEach((paragraph) => {
        if (seenParagraphs.has(paragraph)) return
        seenParagraphs.add(paragraph)
        if (styleMatchesInParagraph(paragraph, target.query, patch)) changed = true
      })
      if (changed)
        changedBlocks.push({
          action: 'style',
          blockId: node.blockId,
          beforeText,
          afterText: beforeText
        })
    })
  } else {
    const editable =
      op.target.type === 'node'
        ? index.editableNodesById.get(op.target.nodeId)
        : index.editableNodesById.get(`node:${op.target.blockId}:self`)
    const block = op.target.type === 'block' ? index.nodesById.get(op.target.blockId) : undefined
    const actualKind = editable?.kind || block?.kind
    const element = editable?.node || block?.node
    if (!actualKind || !element)
      throw new Error(
        `style target not found: ${op.target.type === 'node' ? op.target.nodeId : op.target.blockId}`
      )
    if (expectedKind(actualKind) !== op.patch.kind)
      throw new Error(
        `style patch type mismatch: target is ${actualKind}, patch is ${op.patch.kind}`
      )
    patchNodeStyle(element, op.patch)
    const blockId = editable?.blockId || block?.blockId || ''
    const beforeText = extractBlockText(index, blockId)
    changedBlocks.push({ action: 'style', blockId, beforeText, afterText: beforeText })
  }
  if (changedBlocks.length === 0) throw new Error('style target text not found')
  return {
    buffer: await writeDocumentXml(bundle.zip, bundle.documentDom),
    changedBlocks,
    warnings: []
  }
}

export const applyDocxOps = async (input: {
  buffer: Buffer
  ops: DocxOp[]
}): Promise<ApplyOpsResult> => {
  let buffer = input.buffer
  const changedBlocks: DocxChangedBlock[] = []
  const warnings: string[] = []
  for (const op of input.ops) {
    if (op.type === 'create_document') continue
    if (op.type === 'replace_text') {
      const result = await applyReplaceText(buffer, op)
      buffer = result.buffer
      changedBlocks.push(...result.changedBlocks)
      warnings.push(...result.warnings)
    } else if (op.type === 'style') {
      const result = await applyStyle(buffer, op)
      buffer = result.buffer
      changedBlocks.push(...result.changedBlocks)
      warnings.push(...result.warnings)
    } else {
      const result = await applyStructural(buffer, op)
      buffer = result.buffer
      if (result.changed) changedBlocks.push(result.changed)
      if (result.warning) warnings.push(result.warning)
    }
  }
  return { buffer, changedBlocks, warnings }
}
