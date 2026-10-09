import { childElements, firstChildElement, getAttr } from './dom'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export type DocxStyleContext = {
  stylesDom?: Document
  styles: ReadonlyMap<string, Element>
}

export const indexStyles = (stylesDom?: Document): Map<string, Element> =>
  new Map(
    Array.from(stylesDom?.getElementsByTagNameNS(W, 'style') || []).map((style) => [
      getAttr(style, 'styleId'),
      style
    ])
  )

export const createStyleContext = (stylesDom?: Document): DocxStyleContext => ({
  stylesDom,
  styles: indexStyles(stylesDom)
})

export const fontScript = (text: string): 'eastAsia' | 'cs' | 'hAnsi' | 'ascii' =>
  /\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(text)
    ? 'eastAsia'
    : /\p{Script=Arabic}|\p{Script=Hebrew}|\p{Script=Devanagari}/u.test(text)
      ? 'cs'
      : Array.from(text).every((char) => char.codePointAt(0)! <= 127)
        ? 'ascii'
        : 'hAnsi'
const propertyElements = (element: Element | null): Map<string, Element> =>
  new Map(
    element
      ? childElements(element)
          .filter((e) => !['rStyle', 'pStyle', 'rPr', 'sectPr', 'rsid'].includes(e.localName))
          .map((e) => [e.localName, e])
      : []
  )

export const falseToggles = new Set([
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
export const enabled = (property: Element): boolean =>
  !['0', 'false', 'off'].includes(getAttr(property, 'val'))

export const effectivePropertyElements = (
  context: DocxStyleContext,
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
  const defaults = context.stylesDom?.getElementsByTagNameNS(W, 'docDefaults')[0]
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
