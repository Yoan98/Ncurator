import { createHash } from 'node:crypto'
import path from 'node:path'
import { DOMParser } from '@xmldom/xmldom'
import { childElements, firstChildElement, getAttr, isElementNode } from '../adapters/ooxml/dom'
import { resolveDocxRelationshipTarget } from '../adapters/ooxml/relationshipPath'
import type { DocxStoryPart, ParsedDocxBundle } from '../adapters/ooxml/types'

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
  new Map(
    Array.from(bundle.stylesDom?.getElementsByTagNameNS(W, 'style') || []).map((s) => [
      getAttr(s, 'styleId'),
      s
    ])
  )

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
export const fontScript = (text: string): 'eastAsia' | 'cs' | 'hAnsi' | 'ascii' =>
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text)
    ? 'eastAsia'
    : /\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}/u.test(text)
      ? 'cs'
      : Array.from(text).every((char) => char.codePointAt(0)! <= 127)
        ? 'ascii'
        : 'hAnsi'
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

const propertyElements = (element: Element | null): Map<string, Element> =>
  new Map(
    element
      ? childElements(element)
          .filter((e) => !['rStyle', 'pStyle', 'rPr', 'sectPr', 'rsid'].includes(e.localName))
          .map((e) => [e.localName, e])
      : []
  )

const falseToggles = new Set([
  'b',
  'bCs',
  'i',
  'iCs',
  'strike',
  'dstrike',
  'outline',
  'shadow',
  'emboss',
  'imprint',
  'vanish',
  'webHidden',
  'noProof'
])
const enabled = (property: Element): boolean =>
  !['0', 'false', 'off'].includes(getAttr(property, 'val'))

export const effectivePropertyElements = (
  context: DocumentContext,
  paragraph: Element,
  run?: Element
): Map<string, Element> => {
  const result = new Map<string, Element>()
  const merge = (props: Element | null, toggleStyle = false): void => {
    for (const [key, value] of propertyElements(props)) {
      if (toggleStyle && falseToggles.has(key)) {
        if (!enabled(value)) continue
        const copy = value.cloneNode(true) as Element
        copy.setAttribute('w:val', result.has(key) && enabled(result.get(key)!) ? '0' : '1')
        result.set(key, copy)
      } else if (['rFonts', 'lang', 'spacing', 'ind'].includes(key) && result.has(key)) {
        const copy = result.get(key)!.cloneNode(true) as Element
        for (const attr of Array.from(value.attributes))
          copy.setAttributeNS(attr.namespaceURI, attr.name, attr.value)
        if (key === 'rFonts')
          for (const script of ['ascii', 'hAnsi', 'eastAsia', 'cs'])
            if (value.hasAttribute(`w:${script}`) && !value.hasAttribute(`w:${script}Theme`))
              copy.removeAttribute(`w:${script}Theme`)
        result.set(key, copy)
      } else result.set(key, value)
    }
  }
  const defaults = context.bundle.stylesDom?.getElementsByTagNameNS(W, 'docDefaults')[0]
  if (defaults) merge(defaults.getElementsByTagNameNS(W, run ? 'rPr' : 'pPr')[0] || null)
  const visited = new Set<string>()
  const visitStyle = (id: string): void => {
    if (!id || visited.has(id)) return
    visited.add(id)
    const style = context.styles.get(id)
    if (!style) return
    const base = firstChildElement(style, 'basedOn')
    if (base) visitStyle(getAttr(base, 'val'))
    merge(firstChildElement(style, run ? 'rPr' : 'pPr'), true)
  }
  const pPr = firstChildElement(paragraph, 'pPr'),
    pStyle = pPr && firstChildElement(pPr, 'pStyle')
  const defaultStyle = [...context.styles.values()].find(
    (s) => getAttr(s, 'type') === 'paragraph' && ['1', 'true', 'on'].includes(getAttr(s, 'default'))
  )
  visitStyle(
    pStyle ? getAttr(pStyle, 'val') : defaultStyle ? getAttr(defaultStyle, 'styleId') : 'Normal'
  )
  if (run) {
    const rPr = firstChildElement(run, 'rPr'),
      rStyle = rPr && firstChildElement(rPr, 'rStyle')
    if (rStyle) visitStyle(getAttr(rStyle, 'val'))
    merge(rPr)
  } else merge(pPr)
  return result
}
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
