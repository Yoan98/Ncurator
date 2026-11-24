import type { ParsedDocxBundle, NodeIndex } from './types'
import { childElements, getAttr, firstChildElement } from './dom'
import { wordNamespace } from './sections'

export type RevisionRecord = {
  revisionId: string
  kind: 'insert' | 'delete' | 'move' | 'text_format' | 'paragraph_format' | 'other'
  anchorNodeIds: string[]
  summary: string
  text?: string
  unsupportedReason?: string
}
type NativeChange = { record: RevisionRecord; elements: Element[]; markers: Element[] }
const revisionKinds: Record<string, RevisionRecord['kind']> = {
  ins: 'insert',
  del: 'delete',
  moveFrom: 'move',
  moveTo: 'move',
  rPrChange: 'text_format',
  pPrChange: 'paragraph_format',
  cellIns: 'other',
  cellDel: 'other',
  cellMerge: 'other'
}
export function paragraphMark(change: Element): Element | undefined {
  const properties = change.parentNode?.parentNode as Element | null
  if (
    !['ins', 'del'].includes(change.localName) ||
    (change.parentNode as Element)?.localName !== 'rPr' ||
    properties?.localName !== 'pPr'
  )
    return
  return properties.parentNode as Element
}
export function joinedParagraph(change: Element, accept: boolean): Element | undefined {
  const paragraph = paragraphMark(change)
  if (!paragraph || accept !== (change.localName === 'del')) return
  let next = paragraph.nextSibling
  while (next && next.nodeType !== 1) next = next.nextSibling
  return (next as Element | null)?.localName === 'p' ? (next as Element) : undefined
}
export function indexAnnotations(bundle: ParsedDocxBundle, index: NodeIndex) {
  const owners = new Map<Element, string>()
  for (const [id, node] of index.nodesById)
    if (node.node.localName === 'p' || node.kind === 'table') owners.set(node.node, id)
  const revisions = new Map<string, NativeChange>()
  const comments = new Map<string, { anchorNodeIds: string[]; anchorText: string }>()
  const activeComments = new Set<string>()
  for (const dom of new Set(bundle.stories.map((s) => s.dom))) {
    activeComments.clear()
    const moves = new Map<string, string>()
    const moveByDirection = new Map<string, string>()
    for (const el of Array.from(dom.getElementsByTagNameNS(wordNamespace, '*'))) {
      const name = el.localName,
        id = getAttr(el, 'id')
      let anchor: string | undefined
      for (let n: Node | null = el; n && !anchor; n = n.parentNode)
        anchor = owners.get(n as Element)
      if (name === 'commentRangeStart' || name === 'commentReference') {
        if (!comments.has(id)) comments.set(id, { anchorNodeIds: [], anchorText: '' })
        if (name === 'commentRangeStart') activeComments.add(id)
        if (anchor && !comments.get(id)!.anchorNodeIds.includes(anchor))
          comments.get(id)!.anchorNodeIds.push(anchor)
      }
      if (name === 'commentRangeEnd') activeComments.delete(id)
      if (name === 't')
        for (const cid of activeComments) {
          const c = comments.get(cid)!
          c.anchorText += el.textContent || ''
          if (anchor && !c.anchorNodeIds.includes(anchor)) c.anchorNodeIds.push(anchor)
        }
      const range = /^(moveFrom|moveTo)Range(Start|End)$/.exec(name)
      if (range) {
        const direction = range[1]!
        const key = range[2] === 'Start' ? 'move:' + getAttr(el, 'name') : moves.get(direction + id)
        if (key) {
          if (range[2] === 'Start') {
            moves.set(direction + id, key)
            moveByDirection.set(direction, key)
          } else moveByDirection.delete(direction)
          if (!revisions.has(key))
            revisions.set(key, {
              record: { revisionId: key, kind: 'move', anchorNodeIds: [], summary: '移动' },
              elements: [],
              markers: []
            })
          revisions.get(key)!.markers.push(el)
        }
        continue
      }
      const kind = revisionKinds[name] ?? (name.endsWith('Change') ? 'other' : undefined)
      if (!kind || !id) continue
      const key = kind === 'move' ? (moveByDirection.get(name) ?? id) : id
      const change = revisions.get(key) ?? {
        record: {
          revisionId: key,
          kind,
          anchorNodeIds: [],
          summary: {
            insert: '插入',
            delete: '删除',
            move: '移动',
            text_format: '文字格式',
            paragraph_format: '段落格式',
            other: name
          }[kind]
        },
        elements: [],
        markers: []
      }
      change.elements.push(el)
      if (anchor && !change.record.anchorNodeIds.includes(anchor))
        change.record.anchorNodeIds.push(anchor)
      if (!anchor)
        for (const p of Array.from(el.getElementsByTagNameNS(wordNamespace, 'p'))) {
          const nested = owners.get(p)
          if (nested && !change.record.anchorNodeIds.includes(nested))
            change.record.anchorNodeIds.push(nested)
        }
      if (
        kind === 'other' ||
        (!paragraphMark(el) &&
          ['ins', 'del'].includes(name) &&
          ['trPr', 'rPr', 'numberingChange'].includes(
            (el.parentNode as Element | null)?.localName ?? ''
          ))
      )
        change.record.unsupportedReason = 'Unsupported structural revision: ' + name
      if (['insert', 'delete', 'move'].includes(kind) && name !== 'moveFrom')
        change.record.text =
          (change.record.text ?? '') +
          Array.from(el.getElementsByTagNameNS(wordNamespace, '*'))
            .filter((e) => e.localName === 't' || e.localName === 'delText')
            .map((e) => e.textContent)
            .join('')
      revisions.set(key, change)
    }
  }
  for (const change of revisions.values())
    if (
      change.record.kind === 'move' &&
      (!change.elements.some((e) => e.localName === 'moveFrom') ||
        !change.elements.some((e) => e.localName === 'moveTo'))
    )
      change.record.unsupportedReason = 'Unpaired move revision'
  return { revisions, comments }
}
export function decideRevision(change: NativeChange, accept: boolean) {
  for (const el of change.elements) {
    const parent = el.parentNode as Element | null
    if (!parent) continue
    if (change.record.kind === 'text_format' || change.record.kind === 'paragraph_format') {
      if (!accept) {
        const old = firstChildElement(el, parent.localName)
        if (!old) throw new Error('Missing original formatting')
        for (const child of childElements(parent)) if (child !== el) parent.removeChild(child)
        for (const child of childElements(old)) parent.insertBefore(child.cloneNode(true), el)
      }
      parent.removeChild(el)
    } else if (paragraphMark(el)) {
      const paragraph = paragraphMark(el)!
      const next = joinedParagraph(el, accept)
      parent.removeChild(el)
      if (next) {
        const before = childElements(next).find((child) => child.localName !== 'pPr') ?? null
        for (const child of childElements(paragraph))
          if (child.localName !== 'pPr') next.insertBefore(child, before)
        paragraph.parentNode?.removeChild(paragraph)
      }
    } else {
      const keep = accept === (el.localName === 'ins' || el.localName === 'moveTo')
      if (keep) {
        for (const tag of ['delText', 'delInstrText'])
          for (const deleted of Array.from(el.getElementsByTagNameNS(wordNamespace, tag))) {
            const text = el.ownerDocument.createElementNS(
              wordNamespace,
              tag === 'delText' ? 'w:t' : 'w:instrText'
            )
            for (const attr of Array.from(deleted.attributes))
              text.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
            text.textContent = deleted.textContent
            deleted.parentNode?.replaceChild(text, deleted)
          }
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
      }
      parent.removeChild(el)
    }
  }
  for (const marker of change.markers) marker.parentNode?.removeChild(marker)
}
