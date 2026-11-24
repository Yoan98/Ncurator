import { childElements, firstChildElement, getAttr } from './dom'
import { resolveDocxRelationshipTarget } from './relationshipPath'
import type { ParsedDocxBundle, NodeIndex } from './types'
import type { DocxOperation } from '../../types'

export type SectionFormat = Extract<DocxOperation, { type: 'format_section' }>['format']
export type SlotKind = 'header' | 'footer'
export type SlotVariant = 'default' | 'first' | 'even'
export type SectionSlot = {
  nodeId: string
  variant: SlotVariant
  enabled: boolean
  state: 'missing' | 'local' | 'inherited'
  inheritedFromSectionNodeId?: string
}
export type SectionNode = {
  type: 'section'
  nodeId: string
  sectionIndex: number
  bodyRange?: { fromNodeIndex: number; toNodeIndex: number }
  startType?: 'continuous' | 'next_page' | 'even_page' | 'odd_page' | 'next_column'
  format: SectionFormat
  headers: SectionSlot[]
  footers: SectionSlot[]
}
export const wordNamespace = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const officeRelationships =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const sectionProperties = (bundle: ParsedDocxBundle): Array<Element | null> => {
  const body = bundle.stories[0]!.root
  const breaks = Array.from(body.getElementsByTagNameNS(wordNamespace, 'sectPr')).filter((el) => {
    const properties = el.parentNode as Element
    const paragraph = properties.parentNode as Element
    if (properties.localName !== 'pPr' || paragraph.localName !== 'p') return false
    for (
      let ancestor = paragraph.parentNode;
      ancestor && ancestor !== body;
      ancestor = ancestor.parentNode
    )
      if (['tbl', 'txbxContent', 'del', 'moveFrom'].includes((ancestor as Element).localName))
        return false
    return true
  })
  return [...breaks, firstChildElement(body, 'sectPr')]
}
const flag = (element: Element | null) =>
  Boolean(element && !['off', 'false', '0'].includes(getAttr(element, 'val')))
const distances = {
  marginTopPt: 'top',
  marginRightPt: 'right',
  marginBottomPt: 'bottom',
  marginLeftPt: 'left',
  headerDistancePt: 'header',
  footerDistancePt: 'footer'
} as const
export const readSectionFormat = (section: Element | null): SectionFormat => {
  const size = section && firstChildElement(section, 'pgSz')
  const margins = section && firstChildElement(section, 'pgMar')
  const numbering = section && firstChildElement(section, 'pgNumType')
  const start = numbering && getAttr(numbering, 'start')
  const format: SectionFormat = {
    orientation: size && getAttr(size, 'orient') === 'landscape' ? 'landscape' : 'portrait',
    pageNumberStart: start ? Number(start) : null,
    differentFirstPage: flag(section && firstChildElement(section, 'titlePg'))
  }
  for (const [key, attribute] of Object.entries(distances)) {
    const value = margins && getAttr(margins, attribute)
    if (value) format[key as keyof typeof distances] = Number(value) / 20
  }
  if (size && getAttr(size, 'w')) format.pageWidthPt = Number(getAttr(size, 'w')) / 20
  if (size && getAttr(size, 'h')) format.pageHeightPt = Number(getAttr(size, 'h')) / 20
  return format
}
const sectionOrder = [
  'headerReference',
  'footerReference',
  'footnotePr',
  'endnotePr',
  'type',
  'pgSz',
  'pgMar',
  'paperSrc',
  'pgBorders',
  'lnNumType',
  'pgNumType',
  'cols',
  'formProt',
  'vAlign',
  'noEndnote',
  'titlePg',
  'textDirection',
  'bidi',
  'rtlGutter',
  'docGrid',
  'printerSettings',
  'sectPrChange'
]
export function sectionChild(section: Element, name: string, fresh = false): Element {
  const existing = !fresh && firstChildElement(section, name)
  if (existing) return existing
  const child = section.ownerDocument.createElementNS(wordNamespace, 'w:' + name)
  section.insertBefore(
    child,
    childElements(section).find(
      (el) => sectionOrder.indexOf(el.localName) > sectionOrder.indexOf(name)
    ) || null
  )
  return child
}
export function writeSectionFormat(section: Element, patch: SectionFormat): void {
  const set = (el: Element, key: string, value: string | number) =>
    el.setAttributeNS(wordNamespace, 'w:' + key, String(value))
  if (patch.orientation || patch.pageWidthPt !== undefined) {
    const old = readSectionFormat(section)
    let width = patch.pageWidthPt ?? old.pageWidthPt ?? 595.3
    let height = patch.pageHeightPt ?? old.pageHeightPt ?? 841.9
    const orientation = patch.orientation ?? (width > height ? 'landscape' : 'portrait')
    if (
      (orientation === 'landscape' && width < height) ||
      (orientation === 'portrait' && width > height)
    )
      [width, height] = [height, width]
    const size = sectionChild(section, 'pgSz')
    set(size, 'orient', orientation)
    set(size, 'w', Math.round(width * 20))
    set(size, 'h', Math.round(height * 20))
  }
  if (Object.keys(distances).some((key) => patch[key as keyof typeof distances] !== undefined)) {
    const existing = firstChildElement(section, 'pgMar')
    const margins = existing ?? sectionChild(section, 'pgMar')
    // CT_PageMar requires all seven attributes when the part gains page margins.
    if (!existing) {
      for (const [attribute, value] of Object.entries({
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440,
        header: 720,
        footer: 720,
        gutter: 0
      }))
        set(margins, attribute, value)
    }
    for (const [key, attr] of Object.entries(distances)) {
      const value = patch[key as keyof typeof distances]
      if (value !== undefined) set(margins, attr, Math.round(value * 20))
    }
  }
  if (patch.differentFirstPage !== undefined)
    set(sectionChild(section, 'titlePg'), 'val', patch.differentFirstPage ? '1' : '0')
  if (patch.pageNumberStart === null)
    firstChildElement(section, 'pgNumType')?.removeAttributeNS(wordNamespace, 'start')
  else if (patch.pageNumberStart !== undefined)
    set(sectionChild(section, 'pgNumType'), 'start', patch.pageNumberStart)
}

function encloses(parent: Node, child: Node | null): boolean {
  for (let n = child; n; n = n.parentNode) if (n === parent) return true
  return false
}
const sectionStartTypes: Record<string, SectionNode['startType']> = {
  continuous: 'continuous',
  nextPage: 'next_page',
  evenPage: 'even_page',
  oddPage: 'odd_page',
  nextColumn: 'next_column'
}
export function buildSectionIndex(
  bundle: ParsedDocxBundle,
  index: NodeIndex,
  idFor: (key: string) => string
) {
  const props = sectionProperties(bundle)
  const ranges: Array<SectionNode['bodyRange']> = []
  let ordinal = 0
  for (const nodeId of index.rootNodeIds) {
    const node = index.nodesById.get(nodeId)
    if (node?.category !== 'root' || node.story.type !== 'body') continue
    const range = ranges[ordinal]
    if (range) range.toNodeIndex = node.nodeIndex
    else ranges[ordinal] = { fromNodeIndex: node.nodeIndex, toNodeIndex: node.nodeIndex }
    while (props[ordinal] && encloses(node.node, props[ordinal]!)) ordinal++
  }
  const slots = new Map<
    string,
    { sectionIndex: number; kind: SlotKind; ref: SectionSlot; partName?: string; relId?: string }
  >()
  const previous = new Map<string, { owner: string; relId: string; partName: string }>()
  const sections: SectionNode[] = props.map((prop, sectionIndex) => {
    const nodeId = idFor('section:' + sectionIndex)
    const format = readSectionFormat(prop)
    const type = prop && firstChildElement(prop, 'type')
    const section: SectionNode = {
      type: 'section',
      nodeId,
      sectionIndex,
      format,
      headers: [],
      footers: [],
      ...(ranges[sectionIndex] ? { bodyRange: ranges[sectionIndex] } : {}),
      ...(type ? { startType: sectionStartTypes[getAttr(type, 'val')] } : {})
    }
    for (const kind of ['header', 'footer'] as const)
      for (const variant of ['default', 'first', 'even'] as const) {
        const key = kind + ':' + variant
        const link =
          prop &&
          childElements(prop, kind + 'Reference').find((el) => getAttr(el, 'type') === variant)
        const relId = link?.getAttributeNS(officeRelationships, 'id')
        const partName =
          relId && resolveDocxRelationshipTarget(bundle.relationshipTargets.get(relId) || '')
        if (relId && partName) previous.set(key, { owner: nodeId, relId, partName })
        const binding = previous.get(key)
        const enabled =
          variant === 'default' ||
          (variant === 'first' ? Boolean(format.differentFirstPage) : bundle.evenAndOddHeaders)
        if (!enabled && !binding) continue
        const ref: SectionSlot = {
          nodeId: idFor('slot:' + sectionIndex + ':' + key),
          variant,
          enabled,
          state: link ? 'local' : binding ? 'inherited' : 'missing',
          ...(binding && !link ? { inheritedFromSectionNodeId: binding.owner } : {})
        }
        section[kind === 'header' ? 'headers' : 'footers'].push(ref)
        slots.set(ref.nodeId, {
          sectionIndex,
          kind,
          ref,
          partName: binding?.partName,
          relId: binding?.relId
        })
      }
    return section
  })
  // Deleted block wrappers have no visible nodeIndex. Keep their physical section
  // so their revision records can still be discovered by a scoped read.
  const sectionByBodyBlock = new WeakMap<Node, string>()
  let current = 0
  for (const block of childElements(bundle.stories[0]!.root)) {
    sectionByBodyBlock.set(block, sections[current]!.nodeId)
    while (current < sections.length - 1 && encloses(block, props[current]!)) current++
  }
  return { sections, slots, sectionByBodyBlock }
}

export function sectionsFor(
  structure: ReturnType<typeof buildSectionIndex> | undefined,
  story: string,
  n: number
): string[] {
  if (!structure) return []
  if (story === 'body')
    return structure.sections
      .filter((s) => s.bodyRange && s.bodyRange.fromNodeIndex <= n && n <= s.bodyRange.toNodeIndex)
      .map((s) => s.nodeId)
  return [
    ...new Set(
      [...structure.slots.values()]
        .filter((slot) => slot.partName && slot.kind + ':' + slot.partName === story)
        .map((slot) => structure.sections[slot.sectionIndex]!.nodeId)
    )
  ]
}
