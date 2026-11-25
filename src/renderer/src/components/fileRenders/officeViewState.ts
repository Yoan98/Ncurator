import type { ReviewLocation } from '../../../../shared/fileReview'
import type { SuperDoc } from 'superdoc'
import { t } from '../../i18n'
import { message } from 'antd'
import type { WordSourceParagraph } from './superDocReview'

type WordView = {
  kind: 'docx'
  paragraphId?: string
  text?: string
  offset: number
  textOffset: number
  scrollTop: number
  scrollLeft: number
  zoom?: number
  zoomMode?: 'manual' | 'fit-width' | null
}
export type ExcelView = {
  kind: 'excel'
  sheetId: string
  sheetName: string
  row: number
  column: number
  offsetX: number
  offsetY: number
  zoom: number
  selection?: string
}
const views = new Map<string, WordView | ExcelView>()
const consumed = new Map<string, number>()
export const officeViews = {
  get: (key: string) => views.get(key),
  set(key: string, value: WordView | ExcelView) {
    views.delete(key)
    views.set(key, value)
    if (views.size > 100) {
      const oldest = views.keys().next().value!
      views.delete(oldest)
      consumed.delete(oldest)
    }
  },
  consume(key: string, request?: { id: number; target: ReviewLocation }) {
    if (!request || consumed.get(key) === request.id) return undefined
    consumed.set(key, request.id)
    return request.target
  }
}
const normalize = (text: string) =>
  text.replaceAll(String.fromCharCode(7), ' ').replace(/\s+/g, ' ').trim()
export function wordParagraphs(container: HTMLElement) {
  const groups = new Map<
    string,
    { id: string; story: string; text: string; elements: HTMLElement[]; fragments: Set<string> }
  >()
  for (const el of container.querySelectorAll<HTMLElement>('.superdoc-page [data-para-id]')) {
    if (el.closest('.ts-table-origins')) continue
    const id = el.dataset.paraId!,
      story = el.dataset.layoutStory || 'body'
    const key = story + '\0' + id
    const group = groups.get(key) || {
      id,
      story,
      text: '',
      elements: [],
      fragments: new Set<string>()
    }
    const fragment = el.dataset.layoutFragmentId || id
    if (!group.fragments.has(fragment)) {
      group.text += [...el.querySelectorAll<HTMLElement>('[data-run-id]')]
        .map((run) => run.textContent || '')
        .join('')
      group.fragments.add(fragment)
    }
    group.elements.push(el)
    groups.set(key, group)
  }
  return [...groups.values()]
}
export function captureWordView(container: HTMLElement, key: string, editor?: SuperDoc) {
  if (!container.isConnected) return
  const top = container.getBoundingClientRect().top
  const anchorY = top + container.clientHeight / 2
  const paragraphs = [...container.querySelectorAll<HTMLElement>('.superdoc-page')]
    .filter((page) => {
      const rect = page.getBoundingClientRect()
      return rect.bottom > top && rect.top < top + container.clientHeight
    })
    .flatMap((page) => [
      ...page.querySelectorAll<HTMLElement>('[data-para-id][data-layout-story="body"]')
    ])
    .filter((el) => !el.closest('.ts-table-origins'))
  const visible = paragraphs
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > top && rect.top < top + container.clientHeight)
    .sort(
      (a, b) =>
        Math.abs((a.rect.top + a.rect.bottom) / 2 - anchorY) -
        Math.abs((b.rect.top + b.rect.bottom) / 2 - anchorY)
    )[0]
  const element = visible?.el
  if (!element) return
  const id = element?.dataset.paraId
  const fragments = id
    ? [
        ...container.querySelectorAll<HTMLElement>(
          '[data-para-id="' + CSS.escape(id) + '"][data-layout-story="body"]'
        )
      ].filter((el) => !el.closest('.ts-table-origins'))
    : []
  const texts = fragments.map((el) =>
    [...el.querySelectorAll('[data-run-id]')].map((run) => run.textContent || '').join('')
  )
  const textOffset = texts.slice(0, Math.max(0, fragments.indexOf(element!))).join('').length
  officeViews.set(key, {
    kind: 'docx',
    paragraphId: id,
    text: texts.join(''),
    textOffset,
    offset: element ? element.getBoundingClientRect().top - top : 0,
    scrollTop: container.scrollTop,
    scrollLeft: container.scrollLeft,
    zoom: editor?.ui.zoom.getSnapshot().value,
    zoomMode: editor?.ui.zoom.getSnapshot().mode
  })
}
export async function restoreWordView(
  container: HTMLElement,
  key: string,
  editor: SuperDoc,
  source: WordSourceParagraph[] = [],
  current: () => boolean = () => true
) {
  const view = officeViews.get(key)
  if (view?.kind !== 'docx') return
  if (view.zoomMode === 'fit-width') editor.ui.zoom.setMode('fit-width')
  else if (view.zoom) editor.ui.zoom.set(view.zoom)
  await new Promise(requestAnimationFrame)
  if (!current()) return
  const body = source.filter((p) => p.part === 'word/document.xml')
  const matching = body.filter((p) => p.text === view.text)
  const id =
    body.find((p) => p.id === view.paragraphId && p.text === view.text)?.id ||
    (matching.length === 1 ? matching[0].id : view.paragraphId)
  if (id) {
    await editor.activeEditor?.doc?.info({})
    if (!current()) return
    await editor.activeEditor?.pageMetrics?.revealBodyTarget({
      paraId: id,
      blockOffset: view.textOffset
    })
  }
  await new Promise(requestAnimationFrame)
  if (!current()) return
  const paragraphs = wordParagraphs(container)
  const paragraph =
    paragraphs.find((p) => p.id === view.paragraphId && p.text === view.text) ||
    paragraphs.find((p) => p.text === view.text) ||
    paragraphs.find((p) => p.id === view.paragraphId)
  let offset = 0
  const element =
    paragraph?.elements.find((el) => {
      offset += [...el.querySelectorAll('[data-run-id]')]
        .map((run) => run.textContent || '')
        .join('').length
      return offset > view.textOffset
    }) || paragraph?.elements[0]
  container.scrollTop = element
    ? container.scrollTop +
      element.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      view.offset
    : view.scrollTop
  container.scrollLeft = view.scrollLeft
}
export async function flashWordLocation(
  container: HTMLElement,
  target: Extract<ReviewLocation, { kind: 'docx' }>,
  editor?: SuperDoc,
  source: WordSourceParagraph[] = [],
  current: () => boolean = () => true
): Promise<boolean> {
  const kind = /header/i.test(target.part)
    ? 'header'
    : /footer/i.test(target.part)
      ? 'footer'
      : /footnote/i.test(target.part)
        ? 'footnote'
        : /endnote/i.test(target.part)
          ? 'endnote'
          : 'body'
  const painted = wordParagraphs(container)
  const paragraphs = source.length
    ? source.filter((p) => p.part === target.part)
    : painted.filter((p) =>
        kind === 'body' ? p.story === 'body' : p.story.toLowerCase().includes(kind)
      )
  const original = normalize(target.text),
    quote = normalize(target.quote || '')
  const candidates = paragraphs
    .flatMap((p, index) => {
      const text = normalize(p.text)
      const context =
        target.previous || target.next
          ? Number(normalize(paragraphs[index - 1]?.text || '') === normalize(target.previous)) +
            Number(normalize(paragraphs[index + 1]?.text || '') === normalize(target.next))
          : 0
      const exact = Boolean(original && text === original)
      const retained = Boolean(quote && text.includes(quote))
      if (!exact && !retained && context < 2) return []
      return [{ p, score: Number(exact) * 4 + Number(retained) * 2 + context, exact }]
    })
    .sort((a, b) => b.score - a.score)
  let candidate = candidates[0]
  if (!candidate && target.container && (target.previous || target.next)) {
    const gaps = paragraphs.flatMap((p, index) => {
      if (!target.next) {
        return normalize(p.text) === normalize(target.previous) &&
          paragraphs.slice(index + 1).every((after) => !normalize(after.text))
          ? [{ p, score: 2, exact: false }]
          : []
      }
      if (normalize(p.text) !== normalize(target.next)) return []
      let previous = index - 1
      while (previous >= 0 && !normalize(paragraphs[previous].text)) previous--
      const confirmed = target.previous
        ? previous >= 0 && normalize(paragraphs[previous].text) === normalize(target.previous)
        : previous < 0
      return confirmed ? [{ p, score: 2, exact: false }] : []
    })
    if (gaps.length === 1) candidate = gaps[0]
  }
  if (!candidate || candidates[1]?.score === candidate.score) return false
  if (!normalize(candidate.p.text)) {
    const index = paragraphs.indexOf(candidate.p)
    const neighbor =
      paragraphs.slice(index + 1).find((p) => normalize(p.text)) ||
      paragraphs
        .slice(0, index)
        .reverse()
        .find((p) => normalize(p.text))
    if (neighbor) candidate = { ...candidate, p: neighbor, exact: false }
  }
  if (kind === 'body') {
    await editor?.activeEditor?.doc?.info({})
    if (!current()) return false
    await editor?.activeEditor?.pageMetrics?.revealBodyTarget({ paraId: candidate.p.id })
  }
  await new Promise(requestAnimationFrame)
  if (!current()) return false
  const paragraph = wordParagraphs(container).find((p) => p.id === candidate.p.id)
  if (!paragraph) return false
  const element = paragraph.elements[0]

  let range: Range | undefined
  const rawQuote = target.quote || ''
  const at = rawQuote ? paragraph.text.indexOf(rawQuote) : -1
  if (at >= 0 && paragraph.text.indexOf(rawQuote, at + 1) < 0) {
    let offset = 0
    const current = document.createRange()
    let started = false,
      ended = false
    for (const block of paragraph.elements)
      for (const run of block.querySelectorAll('[data-run-id]')) {
        const walker = document.createTreeWalker(run, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const text = node as Text
          if (!started && at >= offset && at < offset + text.length) {
            current.setStart(text, at - offset)
            started = true
          }
          if (started && !ended && at + rawQuote.length <= offset + text.length) {
            current.setEnd(text, at + rawQuote.length - offset)
            ended = true
          }
          offset += text.length
        }
      }
    if (started && ended) range = current
  }
  ;(range?.startContainer.parentElement || element).scrollIntoView({
    block: 'center',
    behavior: 'instant'
  })
  const highlight = range ? new Highlight(range) : undefined
  if (highlight) CSS.highlights.set('ncurator-office-location', highlight)
  for (const block of paragraph.elements)
    block.setAttribute('data-office-location-highlight', highlight ? 'text' : 'block')
  setTimeout(() => {
    paragraph.elements.forEach((el) => el.removeAttribute('data-office-location-highlight'))
    if (highlight && CSS.highlights.get('ncurator-office-location') === highlight)
      CSS.highlights.delete('ncurator-office-location')
  }, 1500)
  if (!candidate.exact || target.container) message.info(t(($) => $.editors.nearbyChange))
  return true
}
