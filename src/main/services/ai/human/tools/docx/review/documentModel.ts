import { createHash } from 'node:crypto'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { childElements, firstChildElement, getAttr, isElementNode } from '../adapters/ooxml/dom'
import { resolveDocxRelationshipTarget } from '../adapters/ooxml/relationshipPath'
import type { DocxStoryPart, ParsedDocxBundle } from '../adapters/ooxml/types'
import {
  effectivePropertyElements as resolveStyleProperties,
  enabled,
  falseToggles,
  fontScript,
  indexStyles
} from '../adapters/ooxml/styleResolver'
export { fontScript } from '../adapters/ooxml/styleResolver'

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
export const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
export const REVIEW = 'urn:ncurator:docx-review'
export const hash = (value: string | Buffer): string =>
  createHash('sha256').update(value).digest('hex')
export const parseXml = (xml: string): Document =>
  new DOMParser().parseFromString(xml, 'application/xml')
export const relsPath = (part: string): string =>
  path.posix.join(path.posix.dirname(part), '_rels', `${path.posix.basename(part)}.rels`)

export type DocumentContext = {
  bundle: ParsedDocxBundle
  part: DocxStoryPart
  assets: ReadonlyMap<string, string>
  styles: ReadonlyMap<string, Element>
  numbering?: ReadonlyMap<string, string>
  theme?: ReadonlyMap<string, { value: string; fingerprint: string }>
  usedThemes?: Set<string>
}

export const assetHashes = async (bundle: ParsedDocxBundle): Promise<Map<string, string>> => {
  const result = new Map<string, string>()
  for (const name of Object.keys(bundle.zip.files).sort()) {
    const file = bundle.zip.file(name)
    if (file) result.set(name, hash(await file.async('nodebuffer')))
  }
  return result
}

export const relationshipKey = (id: string, context: DocumentContext): string => {
  const target = context.part.relationshipTargets.get(id) || id
  const type = context.part.relationshipTypes.get(id) || ''
  if (context.part.relationshipTargetModes.get(id) === 'External') return `${type}:${target}`
  const part = resolveDocxRelationshipTarget(target, context.part.partName)
  if (/\/(header|footer|footnotes|endnotes)$/.test(type)) return `${type}:${part || target}`
  return `${type}:${part ? context.assets.get(part) || part : target}`
}

/** Ignore serialization noise, not document properties or existing user revisions. */
export const canonical = (element: Element, context?: DocumentContext): string => {
  const hasChildren = childElements(element).length > 0
  const attrs = Array.from(element.attributes)
    .filter(
      (a) =>
        a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' &&
        a.namespaceURI !== REVIEW &&
        !a.name.startsWith('xmlns') &&
        !a.localName.startsWith('rsid') &&
        !['paraId', 'textId'].includes(a.localName) &&
        !(a.localName === 'id' && ['docPr', 'cNvPr'].includes(element.localName))
    )
    .map((a) => [
      `${a.namespaceURI || ''}:${a.localName}`,
      context && a.namespaceURI === R ? relationshipKey(a.value, context) : a.value
    ])
    .sort(([a], [b]) => a!.localeCompare(b!))
  return JSON.stringify([
    element.namespaceURI,
    element.localName,
    attrs,
    Array.from(element.childNodes)
      .filter(
        (n) => n.nodeType === 1 || (n.nodeType === 3 && (!hasChildren || !!n.nodeValue?.trim()))
      )
      .map((n) => (isElementNode(n) ? canonical(n, context) : n.nodeValue))
  ])
}

export const styleMap = (bundle: ParsedDocxBundle): Map<string, Element> =>
  indexStyles(bundle.stylesDom)

export const numberingMap = async (bundle: ParsedDocxBundle): Promise<Map<string, string>> => {
  const file = bundle.zip.file('word/numbering.xml'),
    result = new Map<string, string>()
  if (!file) return result
  const doc = parseXml(await file.async('text'))
  const abstracts = new Map(
    Array.from(doc.getElementsByTagNameNS(W, 'abstractNum')).map((e) => [
      getAttr(e, 'abstractNumId'),
      e
    ])
  )
  for (const num of Array.from(doc.getElementsByTagNameNS(W, 'num'))) {
    const definition = abstracts.get(getAttr(firstChildElement(num, 'abstractNumId')!, 'val'))
    const copy = definition?.cloneNode(true) as Element | undefined
    if (copy) {
      copy.removeAttribute('w:abstractNumId')
      const nsid = firstChildElement(copy, 'nsid')
      if (nsid) copy.removeChild(nsid)
    }
    result.set(
      getAttr(num, 'numId'),
      JSON.stringify([
        copy ? canonical(copy) : '',
        childElements(num)
          .filter((e) => e.localName !== 'abstractNumId')
          .map((e) => canonical(e))
      ])
    )
  }
  return result
}

export const themeMap = async (
  bundle: ParsedDocxBundle
): Promise<Map<string, { value: string; fingerprint: string }>> => {
  const result = new Map<string, { value: string; fingerprint: string }>()
  const name = Object.keys(bundle.zip.files)
    .sort()
    .find((n) => /^word\/theme\/.*\.xml$/.test(n))
  if (!name) return result
  const doc = parseXml(await bundle.zip.file(name)!.async('text'))
  for (const category of ['major', 'minor']) {
    const fonts = doc.getElementsByTagNameNS('*', `${category}Font`)[0]
    if (!fonts) continue
    for (const [suffix, tag, script] of [
      ['Ascii', 'latin', ''],
      ['HAnsi', 'latin', ''],
      ['EastAsia', 'ea', 'Hans'],
      ['Bidi', 'cs', 'Arab']
    ]) {
      const font = childElements(fonts).find((e) => e.localName === tag)
      const fallback = childElements(fonts).find(
        (e) => e.localName === 'font' && e.getAttribute('script') === script
      )
      const selected = font?.getAttribute('typeface') ? font : fallback || font
      result.set(`${category}${suffix}`, {
        value: selected?.getAttribute('typeface') || '',
        fingerprint: selected ? canonical(selected) : ''
      })
    }
  }
  const colors = doc.getElementsByTagNameNS('*', 'clrScheme')[0]
  if (colors)
    for (const color of childElements(colors)) {
      const value = childElements(color)[0]
      if (value)
        result.set(color.localName, {
          value:
            (value.localName === 'sysClr'
              ? value.getAttribute('lastClr')
              : value.getAttribute('val')) || '',
          fingerprint: canonical(value)
        })
    }
  for (const [key, source] of [
    ['dark1', 'dk1'],
    ['light1', 'lt1'],
    ['dark2', 'dk2'],
    ['light2', 'lt2']
  ])
    if (result.has(source!)) result.set(key!, result.get(source!)!)
  return result
}
export const resolveThemeProperty = (
  property: Element,
  theme: DocumentContext['theme'],
  used?: Set<string>,
  text?: string
): Element => {
  const copy = property.cloneNode(true) as Element
  if (copy.localName === 'rFonts' && text !== undefined) {
    const script = fontScript(text),
      names =
        script === 'ascii' || script === 'hAnsi'
          ? ['ascii', 'hAnsi', 'asciiTheme', 'hAnsiTheme']
          : [script, `${script}Theme`]
    for (const attr of Array.from(copy.attributes))
      if (!names.includes(attr.localName)) copy.removeAttribute(attr.name)
  }
  for (const attr of Array.from(copy.attributes)) {
    if (!/theme/i.test(attr.localName)) continue
    const entry = theme?.get(attr.value)
    if (!entry) continue
    used?.add(attr.value)
    const latin = /^(major|minor)(HAnsi|Ascii)$/.exec(attr.value)
    if (latin) {
      used?.add(`${latin[1]}HAnsi`)
      used?.add(`${latin[1]}Ascii`)
    }
    const alias: Record<string, string> = {
      dark1: 'dk1',
      light1: 'lt1',
      dark2: 'dk2',
      light2: 'lt2'
    }
    if (alias[attr.value]) used?.add(alias[attr.value]!)
    const name =
      attr.localName === 'themeColor'
        ? copy.localName === 'color'
          ? 'val'
          : 'color'
        : attr.localName === 'themeFill'
          ? 'fill'
          : attr.localName.replace(/Theme$/, '')
    copy.removeAttribute(attr.name)
    let value = entry.value || entry.fingerprint
    const shadeName = name === 'fill' ? 'themeFillShade' : 'themeShade'
    const tintName = name === 'fill' ? 'themeFillTint' : 'themeTint'
    const shade = getAttr(copy, shadeName),
      tint = getAttr(copy, tintName)
    if (/^[0-9a-f]{6}$/i.test(value) && (shade || tint)) {
      const shadeFactor = shade ? Number.parseInt(shade, 16) / 255 : 1
      const tintFactor = tint ? Number.parseInt(tint, 16) / 255 : 1
      value = value
        .match(/../g)!
        .map((channel) => {
          const darkened = Number.parseInt(channel, 16) * shadeFactor
          const adjusted = tint ? 255 - (255 - darkened) * tintFactor : darkened
          return Math.round(adjusted).toString(16).padStart(2, '0')
        })
        .join('')
        .toUpperCase()
      copy.removeAttribute(`w:${shadeName}`)
      copy.removeAttribute(`w:${tintName}`)
    }
    copy.setAttributeNS(W, `w:${name}`, value)
  }
  if (copy.localName === 'rFonts' && text !== undefined) {
    const script = fontScript(text),
      names =
        script === 'ascii' ? ['ascii', 'hAnsi'] : script === 'hAnsi' ? ['hAnsi', 'ascii'] : [script]
    const value = names.map((name) => getAttr(copy, name)).find(Boolean) || ''
    for (const attr of Array.from(copy.attributes)) copy.removeAttribute(attr.name)
    if (value) copy.setAttributeNS(W, 'w:font', value)
  }
  return copy
}

export const effectivePropertyElements = (
  context: DocumentContext,
  paragraph: Element,
  run?: Element
): Map<string, Element> =>
  resolveStyleProperties(
    { stylesDom: context.bundle.stylesDom, styles: context.styles },
    paragraph,
    run
  )

export const effectiveProperties = (
  context: DocumentContext,
  paragraph: Element,
  run?: Element,
  text?: string
): string => {
  const elements = effectivePropertyElements(context, paragraph, run)
  const result = new Map(
    [...elements].flatMap(([key, value]) => {
      if (falseToggles.has(key)) return enabled(value) ? [[key, 'true'] as const] : []
      if (key === 'u' && getAttr(value, 'val') === 'none') return []
      return [
        [
          key,
          canonical(resolveThemeProperty(value, context.theme, context.usedThemes, text))
        ] as const
      ]
    })
  )
  const numPr = elements.get('numPr')
  if (numPr && context.numbering) {
    const id = firstChildElement(numPr, 'numId'),
      level = firstChildElement(numPr, 'ilvl')
    result.set(
      'numPr',
      JSON.stringify([
        id ? context.numbering.get(getAttr(id, 'val')) || getAttr(id, 'val') : '',
        level ? getAttr(level, 'val') : '0'
      ])
    )
  }
  return JSON.stringify([...result].sort(([a], [b]) => a.localeCompare(b)))
}
