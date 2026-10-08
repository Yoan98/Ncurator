import { sequenceDiff } from './sequenceDiff'
import { childElements, firstChildElement, getAttr } from '../adapters/ooxml/dom'
import {
  canonical,
  effectivePropertyElements,
  effectiveProperties,
  fontScript,
  relationshipKey,
  resolveThemeProperty,
  R,
  REVIEW,
  W
} from './documentModel'
import type { DocumentContext } from './documentModel'

export type ReviewKind = 'inserted' | 'deleted' | 'formatted'
type Fragment = { node: Element; run?: Element; wrappers: Element[]; text?: string }
export type InlineToken = {
  key: string
  text: string
  fragments: Fragment[]
  format: string
  annotation?: boolean
}
const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
export const graphemes = (text: string): string[] =>
  Array.from(segmenter.segment(text), (s) => s.segment)

export const markRun = (run: Element, kind: ReviewKind, border = false): void => {
  if (
    kind === 'formatted' &&
    ['inserted', 'deleted'].includes(run.getAttributeNS(REVIEW, 'change') || '')
  )
    return
  run.setAttributeNS(REVIEW, 'ncr:change', kind)
  let props = firstChildElement(run, 'rPr')
  if (!props) {
    props = run.ownerDocument.createElementNS(W, 'w:rPr')
    run.insertBefore(props, run.firstChild)
  }
  const set = (name: string, attrs: Record<string, string>): void => {
    let prop = firstChildElement(props!, name)
    if (!prop) {
      prop = run.ownerDocument.createElementNS(W, `w:${name}`)
      props!.appendChild(prop)
    }
    for (const [key, value] of Object.entries(attrs)) prop.setAttribute(`w:${key}`, value)
  }
  if (kind !== 'formatted') {
    const color = firstChildElement(props, 'color')
    for (const name of ['themeColor', 'themeTint', 'themeShade'])
      color?.removeAttribute(`w:${name}`)
    set('color', { val: kind === 'deleted' ? 'B42318' : '166534' })
    if (kind === 'deleted') set('strike', { val: '1' })
  }
  let background = !!(firstChildElement(props, 'shd') || firstChildElement(props, 'highlight'))
  for (
    let ancestor = run.parentNode;
    !background && ancestor?.nodeType === 1;
    ancestor = ancestor.parentNode
  ) {
    const parent = ancestor as Element
    const property = firstChildElement(
      parent,
      parent.localName === 'tc' ? 'tcPr' : parent.localName === 'tbl' ? 'tblPr' : 'pPr'
    )
    background ||= !!(property && firstChildElement(property, 'shd'))
  }
  if (background || border)
    set('bdr', {
      val: 'single',
      sz: '4',
      color: kind === 'deleted' ? 'B42318' : '166534',
      space: '1'
    })
  else set('shd', { val: 'clear', fill: kind === 'deleted' ? 'FDECEC' : 'E9F7EF' })
}

export const markElement = (element: Element, kind: ReviewKind, border = false): void => {
  element.setAttributeNS(REVIEW, 'ncr:change', kind)
  if (element.localName === 'r') markRun(element, kind, border)
  else
    for (const run of Array.from(element.getElementsByTagNameNS(W, 'r'))) markRun(run, kind, border)
  if (!element.getElementsByTagNameNS(W, 'r').length && element.localName === 'p') {
    const props =
      firstChildElement(element, 'pPr') || element.ownerDocument.createElementNS(W, 'w:pPr')
    if (!props.parentNode) element.insertBefore(props, element.firstChild)
    const borders = element.ownerDocument.createElementNS(W, 'w:pBdr')
    const left = element.ownerDocument.createElementNS(W, 'w:left')
    left.setAttribute('w:val', 'single')
    left.setAttribute('w:sz', '8')
    left.setAttribute('w:color', kind === 'deleted' ? 'B42318' : '166534')
    borders.appendChild(left)
    props.appendChild(borders)
  }
}

/** Tokenize visible characters independently of the document's arbitrary run boundaries. */
export const paragraphTokens = (paragraph: Element, context: DocumentContext): InlineToken[] => {
  const tokens: InlineToken[] = []
  let pending: Fragment[] = []
  const formats = new Map<Element, Map<string, string>>()
  const format = (run: Element, text?: string): string => {
    let cache = formats.get(run)
    if (!cache) {
      cache = new Map()
      formats.set(run, cache)
    }
    const key = text === undefined ? 'object' : fontScript(text)
    let value = cache.get(key)
    if (value === undefined) {
      value = effectiveProperties(context, paragraph, run, text)
      cache.set(key, value)
    }
    return value
  }
  const flush = (): void => {
    if (!pending.length) return
    const full = pending.map((f) => f.text || '').join('')
    const ranges = pending.map((f) => ({ f, start: 0, end: 0 }))
    let offset = 0
    for (const range of ranges) {
      range.start = offset
      offset += range.f.text!.length
      range.end = offset
    }
    let rangeIndex = 0
    for (const segment of segmenter.segment(full)) {
      const start = segment.index,
        end = start + segment.segment.length
      while (rangeIndex < ranges.length && ranges[rangeIndex]!.end <= start) rangeIndex++
      const fragments: Fragment[] = []
      const formats: string[] = []
      for (let i = rangeIndex; i < ranges.length && ranges[i]!.start < end; i++) {
        const range = ranges[i]!
        fragments.push({
          ...range.f,
          text: range.f.text!.slice(
            Math.max(start - range.start, 0),
            Math.min(end - range.start, range.f.text!.length)
          )
        })
        formats.push(
          format(range.f.run!, segment.segment) +
            range.f.wrappers.map((w) => canonical(w.cloneNode(false) as Element, context)).join('')
        )
      }
      tokens.push({
        key: `text:${segment.segment}`,
        text: segment.segment,
        fragments,
        format: [...new Set(formats)].join('|')
      })
    }
    pending = []
  }
  const atomic = (fragment: Fragment): void => {
    flush()
    const visual = ['drawing', 'pict', 'object'].includes(fragment.node.localName)
    const references = visual
      ? [fragment.node, ...Array.from(fragment.node.getElementsByTagName('*'))].flatMap((node) =>
          Array.from(node.attributes)
            .filter((a) => a.namespaceURI === R)
            .map((a) => relationshipKey(a.value, context))
        )
      : []
    const key = visual
      ? JSON.stringify([
          fragment.node.localName,
          references,
          Array.from(fragment.node.getElementsByTagNameNS(W, 't')).map((t) => t.textContent)
        ])
      : canonical(fragment.node, context)
    tokens.push({
      key: `object:${key}`,
      text: '',
      fragments: [fragment],
      format:
        (fragment.run ? format(fragment.run) : '') +
        (visual ? canonical(fragment.node, context) : ''),
      annotation: ['commentRangeStart', 'commentRangeEnd', 'commentReference'].includes(
        fragment.node.localName
      )
    })
  }
  const visit = (element: Element, wrappers: Element[]): void => {
    if (element.localName === 'hyperlink') {
      childElements(element).forEach((e) => visit(e, [...wrappers, element]))
      return
    }
    if (element.localName !== 'r') {
      atomic({ node: element, wrappers })
      return
    }
    for (const child of childElements(element)) {
      if (child.localName === 'rPr') continue
      if (child.localName === 't')
        pending.push({ node: child, run: element, wrappers, text: child.textContent || '' })
      else if (['tab', 'br', 'cr'].includes(child.localName)) {
        flush()
        tokens.push({
          key: `${child.localName}:${getAttr(child, 'type')}`,
          text: child.localName === 'tab' ? '\t' : '\n',
          fragments: [{ node: child, run: element, wrappers }],
          format: format(element)
        })
      } else atomic({ node: child, run: element, wrappers })
    }
  }
  const children = childElements(paragraph).filter((e) => e.localName !== 'pPr')
  for (let i = 0; i < children.length; i++) {
    const element = children[i]!
    const fields = (node: Element): Element[] =>
      Array.from(node.getElementsByTagNameNS(W, 'fldChar'))
    if (fields(element).some((f) => getAttr(f, 'fldCharType') === 'begin')) {
      flush()
      const group: Element[] = []
      let depth = 0
      do {
        const current = children[i++]!
        group.push(current)
        for (const field of fields(current)) {
          if (getAttr(field, 'fldCharType') === 'begin') depth++
          else if (getAttr(field, 'fldCharType') === 'end') depth--
        }
      } while (depth > 0 && i < children.length)
      i--
      tokens.push({
        key: `field:${group.map((e) => canonical(e, context)).join('')}`,
        text: '',
        fragments: group.map((node) => ({ node, wrappers: [] })),
        format: ''
      })
    } else visit(element, [])
  }
  flush()
  return tokens
}

export const paragraphContentKey = (paragraph: Element, context: DocumentContext): string =>
  JSON.stringify(
    paragraphTokens(paragraph, context)
      .filter((t) => !t.annotation)
      .map((t) => t.key)
  )

type SelectedToken = { token: InlineToken; kind?: ReviewKind; border?: boolean }

const appendTokens = (paragraph: Element, selected: SelectedToken[]): void => {
  let lastRun: Element | undefined,
    lastRunSource: Element | undefined,
    lastKind: ReviewKind | undefined
  let lastWrappers: Element[] = [],
    wrapperCopies: Element[] = []
  let lastBorder: boolean | undefined
  for (const { token, kind, border } of selected)
    for (const fragment of token.fragments) {
      let parent = paragraph
      for (let depth = 0; depth < fragment.wrappers.length; depth++) {
        const wrapper = fragment.wrappers[depth]!
        if (lastWrappers[depth] !== wrapper) {
          lastWrappers = fragment.wrappers.slice(0, depth + 1)
          wrapperCopies = wrapperCopies.slice(0, depth)
          const copy = paragraph.ownerDocument.importNode(wrapper, false) as Element
          parent.appendChild(copy)
          wrapperCopies.push(copy)
          lastRun = undefined
        }
        parent = wrapperCopies[depth]!
      }
      if (fragment.wrappers.length !== lastWrappers.length) {
        lastWrappers = fragment.wrappers
        wrapperCopies = wrapperCopies.slice(0, fragment.wrappers.length)
        lastRun = undefined
      }
      if (!fragment.run) {
        const node = paragraph.ownerDocument.importNode(fragment.node, true) as Element
        if (kind) markElement(node, kind)
        parent.appendChild(node)
        lastRun = undefined
        continue
      }
      if (
        !lastRun ||
        lastRunSource !== fragment.run ||
        lastKind !== kind ||
        lastBorder !== border ||
        lastRun.parentNode !== parent
      ) {
        lastRun = paragraph.ownerDocument.importNode(fragment.run, false) as Element
        const props = firstChildElement(fragment.run, 'rPr')
        if (props) lastRun.appendChild(paragraph.ownerDocument.importNode(props, true))
        parent.appendChild(lastRun)
        if (kind) markRun(lastRun, kind, border)
        lastRunSource = fragment.run
        lastKind = kind
        lastBorder = border
      }
      if (fragment.text !== undefined) {
        const previous = lastRun.lastChild
        if (previous?.nodeType === 1 && (previous as Element).localName === 't') {
          previous.textContent = (previous.textContent || '') + fragment.text
          ;(previous as Element).setAttribute('xml:space', 'preserve')
        } else {
          const text = paragraph.ownerDocument.importNode(fragment.node, false) as Element
          text.textContent = fragment.text
          text.setAttribute('xml:space', 'preserve')
          lastRun.appendChild(text)
        }
      } else lastRun.appendChild(paragraph.ownerDocument.importNode(fragment.node, true))
    }
}

export type InlineResult = { element: Element; textChanged: boolean; formatChanged: boolean }
export const renderParagraphDiff = (
  before: Element,
  after: Element,
  oldContext: DocumentContext,
  newContext: DocumentContext,
  forceFormat = false
): InlineResult => {
  const oldTokens = paragraphTokens(before, oldContext),
    newTokens = paragraphTokens(after, newContext)
  const paragraphFormatChanged =
    forceFormat ||
    effectiveProperties(oldContext, before) !== effectiveProperties(newContext, after)
  const selected: SelectedToken[] = []
  const frozenRuns = new Map<Element, Element>()
  const deletedToken = (token: InlineToken): InlineToken => ({
    ...token,
    fragments: token.fragments.map((fragment) => {
      const original = fragment.run || (fragment.node.localName === 'r' ? fragment.node : undefined)
      if (!original) return fragment
      let frozen = frozenRuns.get(original)
      if (!frozen) {
        frozen = original.cloneNode(true) as Element
        let props = firstChildElement(frozen, 'rPr')
        if (!props) {
          props = frozen.ownerDocument.createElementNS(W, 'w:rPr')
          frozen.insertBefore(props, frozen.firstChild)
        }
        const source = effectivePropertyElements(oldContext, before, original)
        const target = effectivePropertyElements(
          newContext,
          after,
          after.ownerDocument.createElementNS(W, 'w:r')
        )
        for (const name of [
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
          'noProof',
          'u'
        ])
          if (!source.has(name) && target.has(name)) {
            const property = frozen.ownerDocument.createElementNS(W, `w:${name}`)
            property.setAttribute('w:val', name === 'u' ? 'none' : '0')
            source.set(name, property)
          }
        for (const [name, property] of source) {
          const existing = firstChildElement(props, name)
          if (existing) props.removeChild(existing)
          props.appendChild(resolveThemeProperty(property, oldContext.theme))
        }
        frozenRuns.set(original, frozen)
      }
      return fragment.run ? { ...fragment, run: frozen } : { ...fragment, node: frozen }
    })
  })
  let oldIndex = 0,
    newIndex = 0,
    textChanged = false,
    formatChanged = paragraphFormatChanged
  const chunks = sequenceDiff(
    oldTokens.map((t) => t.key),
    newTokens.map((t) => t.key)
  )
  // Myers can emit insertion before deletion; replacements always show old before new.
  for (let i = 0; i < chunks.length - 1; i++)
    if (chunks[i]!.added && chunks[i + 1]!.removed)
      [chunks[i], chunks[i + 1]] = [chunks[i + 1]!, chunks[i]!]
  for (const chunk of chunks) {
    if (chunk.removed) {
      const removed = oldTokens
        .slice(oldIndex, oldIndex + chunk.count!)
        .filter((token) => !token.annotation)
      for (const token of removed) selected.push({ token: deletedToken(token), kind: 'deleted' })
      oldIndex += chunk.count!
      textChanged ||= !!removed.length
    } else if (chunk.added) {
      const added = newTokens.slice(newIndex, newIndex + chunk.count!)
      for (const token of added)
        selected.push({ token, kind: token.annotation ? undefined : 'inserted' })
      newIndex += chunk.count!
      textChanged ||= added.some((token) => !token.annotation)
    } else {
      for (let count = 0; count < chunk.count!; count++) {
        const token = newTokens[newIndex++]!,
          old = oldTokens[oldIndex++]!
        const changed = paragraphFormatChanged || old.format !== token.format
        selected.push({
          token,
          kind: changed ? 'formatted' : undefined,
          border: changed && /shd|highlight/.test(old.format)
        })
        formatChanged ||= changed
      }
    }
  }
  const result = after.cloneNode(false) as Element
  const props = firstChildElement(after, 'pPr')
  if (props) result.appendChild(props.cloneNode(true))
  appendTokens(result, selected)
  if (paragraphFormatChanged && !selected.length) markElement(result, 'formatted')
  return { element: result, textChanged, formatChanged }
}
