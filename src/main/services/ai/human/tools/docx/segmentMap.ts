import { Jieba } from '@node-rs/jieba'
import { dict } from '@node-rs/jieba/dict'
import {
  DOCX_OUTLINE_ANCHOR_MAX_CHARS,
  DOCX_OUTLINE_KEYWORD_EDIT_SIMILARITY_THRESHOLD,
  DOCX_OUTLINE_KEYWORD_JACCARD_THRESHOLD,
  DOCX_OUTLINE_KEYWORD_MAX_CHARS,
  DOCX_OUTLINE_KEYWORD_MIN_SCORE_RATIO,
  DOCX_OUTLINE_MMR_DIVERSITY_WEIGHT,
  DOCX_OUTLINE_MMR_RELEVANCE_WEIGHT,
  DOCX_OUTLINE_SEGMENT_BOUNDARY_LOOKAHEAD,
  DOCX_OUTLINE_SEGMENT_MAP_MAX_CHARS,
  DOCX_OUTLINE_SEGMENT_MAX_NODES,
  DOCX_OUTLINE_SEGMENT_MAX_VISIBLE_CHARS,
  DOCX_OUTLINE_SEGMENT_TARGET_NODES
} from './constants'
import type { DocxOutlineNode, DocxOutlineSegment } from './types'
import type { NodeIndex, ParsedDocxBundle } from './adapters/ooxml/types'
import { collectVisualAltTexts } from './adapters/ooxml/contentTree'

type RootItem = {
  node: Exclude<DocxOutlineNode, { type: 'table_cell' }>
  element: Element
  text: string
  isolated: boolean
  boundaryBefore: boolean
  boundaryAfter: boolean
  anchor: string
}

type DraftSegment = {
  story: DocxOutlineSegment['story']
  items: RootItem[]
}

type SentenceCandidate = {
  nodeIndex: number
  text: string
  vector: Map<string, number>
}

const jieba = Jieba.withDict(dict)
const unicodeWordSegmenter = new Intl.Segmenter('und', { granularity: 'word' })
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'this',
  'with',
  'from',
  'are',
  'was',
  'were',
  'has',
  'have',
  'had',
  '的',
  '了',
  '和',
  '与',
  '及',
  '是',
  '在',
  '为',
  '对',
  '中',
  '上',
  '下',
  '本',
  '该'
])

const chars = (value: string): string[] => Array.from(value)
const charLength = (value: string): number => chars(value).length
const takeChars = (value: string, limit: number): string => chars(value).slice(0, limit).join('')
const normalizeSpace = (value: string): string => value.replace(/\s+/gu, ' ').trim()
const truncateEnds = (value: string, budget: number): string => {
  if (charLength(value) <= budget) return value
  if (budget <= 1) return ''
  const head = Math.ceil((budget - 1) * 0.65)
  return `${chars(value).slice(0, head).join('')}…${chars(value)
    .slice(-(budget - head - 1))
    .join('')}`
}
const normalizeLexical = (value: string): string =>
  normalizeSpace(value.normalize('NFKC').toLocaleLowerCase()).replace(/[\p{P}\p{S}]+/gu, '')

const directChild = (element: Element, localName: string): Element | undefined => {
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes.item(index)
    if (child?.nodeType === 1 && (child as Element).localName === localName) {
      return child as Element
    }
  }
  return undefined
}

const localAttribute = (element: Element, name: string): string => {
  for (let index = 0; index < element.attributes.length; index += 1) {
    const attribute = element.attributes.item(index)
    if (attribute?.localName === name) return attribute.value
  }
  return ''
}

const propertyValue = (properties: Element | undefined, name: string): string => {
  const property = properties ? directChild(properties, name) : undefined
  return property ? localAttribute(property, 'val') : ''
}

const isEnabledProperty = (property: Element | undefined): boolean =>
  Boolean(
    property && !['0', 'false', 'off'].includes(localAttribute(property, 'val').toLowerCase())
  )

type StyleFacts = { outlineLevel?: number; pageBreakBefore: boolean }

const buildStyleFacts = (stylesDom: Document | undefined): Map<string, StyleFacts> => {
  if (!stylesDom) return new Map()
  const raw = new Map<
    string,
    { basedOn?: string; outlineLevel?: number; pageBreakBefore: boolean }
  >()
  Array.from(stylesDom.getElementsByTagNameNS('*', 'style')).forEach((style) => {
    if (localAttribute(style, 'type') !== 'paragraph') return
    const styleId = localAttribute(style, 'styleId')
    if (!styleId) return
    const properties = directChild(style, 'pPr')
    const rawLevel = propertyValue(properties, 'outlineLvl')
    const level = rawLevel === '' ? undefined : Number(rawLevel)
    raw.set(styleId, {
      basedOn: propertyValue(style, 'basedOn') || undefined,
      outlineLevel: Number.isInteger(level) ? level : undefined,
      pageBreakBefore: isEnabledProperty(directChild(properties || style, 'pageBreakBefore'))
    })
  })

  const resolved = new Map<string, StyleFacts>()
  const resolve = (styleId: string, visiting: Set<string>): StyleFacts => {
    const cached = resolved.get(styleId)
    if (cached) return cached
    const current = raw.get(styleId)
    if (!current || visiting.has(styleId)) return { pageBreakBefore: false }
    const nextVisiting = new Set(visiting).add(styleId)
    const parent = current.basedOn ? resolve(current.basedOn, nextVisiting) : undefined
    const facts = {
      outlineLevel: current.outlineLevel ?? parent?.outlineLevel,
      pageBreakBefore: current.pageBreakBefore || Boolean(parent?.pageBreakBefore)
    }
    resolved.set(styleId, facts)
    return facts
  }
  raw.forEach((_value, styleId) => resolve(styleId, new Set()))
  return resolved
}

const paragraphBoundaryFacts = (
  paragraph: Element,
  styleFacts: Map<string, StyleFacts>
): { outline: boolean; pageBefore: boolean; explicitBreak: boolean; sectionAfter: boolean } => {
  const properties = directChild(paragraph, 'pPr')
  const styleId = propertyValue(properties, 'pStyle')
  const inherited = styleId ? styleFacts.get(styleId) : undefined
  const rawOutline = propertyValue(properties, 'outlineLvl')
  const directOutline = rawOutline === '' ? undefined : Number(rawOutline)
  const breaks = Array.from(paragraph.getElementsByTagNameNS('*', 'br'))
  return {
    outline:
      (directOutline !== undefined &&
        Number.isInteger(directOutline) &&
        directOutline >= 0 &&
        directOutline <= 8) ||
      (inherited?.outlineLevel !== undefined &&
        inherited.outlineLevel >= 0 &&
        inherited.outlineLevel <= 8),
    pageBefore:
      isEnabledProperty(directChild(properties || paragraph, 'pageBreakBefore')) ||
      Boolean(inherited?.pageBreakBefore),
    explicitBreak: breaks.some((item) => ['page', 'column'].includes(localAttribute(item, 'type'))),
    sectionAfter: Boolean(properties && directChild(properties, 'sectPr'))
  }
}

const visibleElementText = (element: Element): string => {
  const parts: string[] = []
  const visit = (node: Node): void => {
    if (node.nodeType !== 1) return
    const child = node as Element
    if (child.localName === 't' || child.localName === 'delText') {
      parts.push(child.textContent || '')
      return
    }
    if (child.localName === 'tab') parts.push('\t')
    if (child.localName === 'br' || child.localName === 'cr') parts.push('\n')
    for (let index = 0; index < child.childNodes.length; index += 1) {
      const nested = child.childNodes.item(index)
      if (nested) visit(nested)
    }
  }
  visit(element)
  return normalizeSpace(parts.join(''))
}

const firstTableRowText = (table: Element): string => {
  const rows = Array.from(table.getElementsByTagNameNS('*', 'tr'))
  for (const row of rows) {
    const cells = Array.from(row.getElementsByTagNameNS('*', 'tc'))
      .map(visibleElementText)
      .filter(Boolean)
    if (cells.length > 0) return cells.join(' | ')
  }
  return ''
}

const visualAnchor = (element: Element, node: RootItem['node']): string => {
  if (!node.visuals) return ''
  const descriptions = collectVisualAltTexts(element)
  const kinds = node.visuals.kinds.join('/')
  return normalizeSpace(
    `视觉 ${kinds}${descriptions.length > 0 ? ` ${descriptions.join(' ')}` : ''}`
  )
}

const buildRootItems = (
  index: NodeIndex,
  bundle?: Pick<ParsedDocxBundle, 'stylesDom'>
): RootItem[] => {
  const outlineById = new Map(index.outline.map((node) => [node.nodeId, node]))
  const styles = buildStyleFacts(bundle?.stylesDom)
  return index.rootNodeIds.flatMap((nodeId) => {
    const indexed = index.nodesById.get(nodeId)
    const outline = outlineById.get(nodeId)
    if (!indexed || !outline || outline.type === 'table_cell') return []
    const paragraphFacts =
      outline.type === 'paragraph'
        ? paragraphBoundaryFacts(indexed.node, styles)
        : { outline: false, pageBefore: false, explicitBreak: false, sectionAfter: false }
    const visual = Boolean(outline.visuals?.count)
    const isolated = outline.type === 'table' || outline.type === 'content_control' || visual
    const anchors: string[] = []
    if (outline.type === 'paragraph' && paragraphFacts.outline) anchors.push(outline.text)
    if (outline.type === 'table') {
      const firstRow = firstTableRowText(indexed.node)
      anchors.push(
        `表格 ${String(outline.rows)}x${String(outline.cols)}${firstRow ? ` ${firstRow}` : ''}`
      )
    }
    if (outline.type === 'content_control') {
      anchors.push(`内容控件${outline.tag ? ` ${outline.tag}` : ''}`)
    }
    if (visual) anchors.push(visualAnchor(indexed.node, outline))
    return [
      {
        node: outline,
        element: indexed.node,
        text: outline.text,
        isolated,
        boundaryBefore: paragraphFacts.outline || paragraphFacts.pageBefore,
        boundaryAfter: paragraphFacts.explicitBreak || paragraphFacts.sectionAfter,
        anchor: normalizeSpace(anchors.filter(Boolean).join('；'))
      }
    ]
  })
}

const segmentStory = (items: RootItem[]): DraftSegment[] => {
  const segments: DraftSegment[] = []
  let cursor = 0
  const push = (selected: RootItem[]): void => {
    if (selected.length === 0) return
    segments.push({ story: selected[0]!.node.story.type, items: selected })
  }
  while (cursor < items.length) {
    const first = items[cursor]!
    if (first.isolated) {
      push([first])
      cursor += 1
      continue
    }
    const selected: RootItem[] = []
    let visibleChars = 0
    while (cursor < items.length && selected.length < DOCX_OUTLINE_SEGMENT_MAX_NODES) {
      const item = items[cursor]!
      if (selected.length > 0 && (item.isolated || item.boundaryBefore)) break
      const nextChars = charLength(item.text)
      if (
        selected.length > 0 &&
        visibleChars + nextChars > DOCX_OUTLINE_SEGMENT_MAX_VISIBLE_CHARS
      ) {
        break
      }
      selected.push(item)
      visibleChars += nextChars
      cursor += 1
      if (item.boundaryAfter) break
      if (selected.length === DOCX_OUTLINE_SEGMENT_TARGET_NODES) {
        const lookaheadEnd = Math.min(
          items.length,
          cursor + DOCX_OUTLINE_SEGMENT_BOUNDARY_LOOKAHEAD
        )
        let boundaryIndex = -1
        for (let index = cursor; index < lookaheadEnd; index += 1) {
          const candidate = items[index]!
          if (candidate.isolated || candidate.boundaryBefore) {
            boundaryIndex = index
            break
          }
          if (candidate.boundaryAfter) {
            boundaryIndex = index + 1
            break
          }
        }
        if (boundaryIndex < 0) break
        while (cursor < boundaryIndex && selected.length < DOCX_OUTLINE_SEGMENT_MAX_NODES) {
          const candidate = items[cursor]!
          const candidateChars = charLength(candidate.text)
          if (visibleChars + candidateChars > DOCX_OUTLINE_SEGMENT_MAX_VISIBLE_CHARS) break
          selected.push(candidate)
          visibleChars += candidateChars
          cursor += 1
        }
        break
      }
    }
    push(selected)
  }
  return segments
}

const tokenize = (text: string): string[] => {
  const normalized = normalizeSpace(text.normalize('NFKC').toLocaleLowerCase())
  const tokens = Array.from(unicodeWordSegmenter.segment(normalized)).flatMap((item) => {
    if (!item.isWordLike) return []
    return /\p{Script=Han}/u.test(item.segment)
      ? jieba.cutForSearch(item.segment, true)
      : [item.segment]
  })
  return tokens
    .map((token) => token.replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, ''))
    .filter((token) => charLength(token) >= 2 && !/^\d+$/u.test(token) && !STOP_WORDS.has(token))
}

const splitSentences = (item: RootItem): Array<{ nodeIndex: number; text: string }> => {
  if (item.node.type === 'table') {
    return Array.from(item.element.getElementsByTagNameNS('*', 'tr'))
      .map((row) =>
        Array.from(row.getElementsByTagNameNS('*', 'tc'))
          .map(visibleElementText)
          .filter(Boolean)
          .join(' | ')
      )
      .filter(Boolean)
      .map((text) => ({ nodeIndex: item.node.nodeIndex, text }))
  }
  return item.text
    .split(/(?<=[。！？!?；;])|\r?\n+/u)
    .map(normalizeSpace)
    .filter(Boolean)
    .map((text) => ({ nodeIndex: item.node.nodeIndex, text }))
}

const termCounts = (tokens: string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1))
  return counts
}

const vectorize = (text: string, idf: Map<string, number>): Map<string, number> => {
  const tokens = tokenize(text)
  const counts = termCounts(tokens)
  const vector = new Map<string, number>()
  if (tokens.length === 0) return vector
  counts.forEach((count, token) =>
    vector.set(token, (count / tokens.length) * (idf.get(token) || 1))
  )
  return vector
}

const cosine = (left: Map<string, number>, right: Map<string, number>): number => {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  left.forEach((value, token) => {
    dot += value * (right.get(token) || 0)
    leftNorm += value * value
  })
  right.forEach((value) => {
    rightNorm += value * value
  })
  return leftNorm > 0 && rightNorm > 0 ? dot / Math.sqrt(leftNorm * rightNorm) : 0
}

const centroid = (vectors: Array<Map<string, number>>): Map<string, number> => {
  const result = new Map<string, number>()
  if (vectors.length === 0) return result
  vectors.forEach((vector) => {
    vector.forEach((value, token) => result.set(token, (result.get(token) || 0) + value))
  })
  result.forEach((value, token) => result.set(token, value / vectors.length))
  return result
}

const lexicalParts = (value: string): Set<string> => new Set(tokenize(value))
const jaccard = (left: string, right: string): number => {
  const leftParts = lexicalParts(left)
  const rightParts = lexicalParts(right)
  const union = new Set([...leftParts, ...rightParts])
  if (union.size === 0) return left === right ? 1 : 0
  let intersection = 0
  leftParts.forEach((part) => {
    if (rightParts.has(part)) intersection += 1
  })
  return intersection / union.size
}

const editSimilarity = (leftValue: string, rightValue: string): number => {
  const left = chars(normalizeLexical(leftValue))
  const right = chars(normalizeLexical(rightValue))
  const longest = Math.max(left.length, right.length)
  if (longest === 0) return 1
  let previous = Array.from({ length: right.length + 1 }, (_item, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous = current
  }
  return 1 - previous[right.length]! / longest
}

const selectKeywords = (text: string, idf: Map<string, number>): string => {
  const tokens = tokenize(text)
  const counts = termCounts(tokens)
  const ranked = [...counts.entries()]
    .map(([token, count]) => ({
      token,
      score: (count / Math.max(1, tokens.length)) * (idf.get(token) || 1)
    }))
    .sort(
      (left, right) => right.score - left.score || charLength(right.token) - charLength(left.token)
    )
  const highest = ranked[0]?.score || 0
  const selected: typeof ranked = []
  for (const candidate of ranked) {
    if (candidate.score < highest * DOCX_OUTLINE_KEYWORD_MIN_SCORE_RATIO) break
    const duplicateIndex = selected.findIndex((current) => {
      const left = normalizeLexical(current.token)
      const right = normalizeLexical(candidate.token)
      return (
        left === right ||
        left.includes(right) ||
        right.includes(left) ||
        jaccard(left, right) >= DOCX_OUTLINE_KEYWORD_JACCARD_THRESHOLD ||
        editSimilarity(left, right) >= DOCX_OUTLINE_KEYWORD_EDIT_SIMILARITY_THRESHOLD
      )
    })
    if (duplicateIndex >= 0) {
      const current = selected[duplicateIndex]!
      if (
        candidate.score >= current.score * 0.9 &&
        charLength(candidate.token) > charLength(current.token)
      ) {
        const replacement = selected.map((item, index) =>
          index === duplicateIndex ? candidate.token : item.token
        )
        if (charLength(replacement.join('、')) <= DOCX_OUTLINE_KEYWORD_MAX_CHARS) {
          selected[duplicateIndex] = candidate
        }
      }
      continue
    }
    const next = [...selected.map((item) => item.token), candidate.token].join('、')
    if (charLength(next) <= DOCX_OUTLINE_KEYWORD_MAX_CHARS) selected.push(candidate)
  }
  return selected.map((item) => item.token).join('、')
}

const selectRepresentatives = (
  candidates: SentenceCandidate[],
  budget: number
): Array<{ nodeIndex: number; text: string }> => {
  if (budget <= 0 || candidates.length === 0) return []
  const center = centroid(candidates.map((candidate) => candidate.vector))
  const remaining = [...candidates]
  const selected: SentenceCandidate[] = []
  let used = 0
  while (remaining.length > 0) {
    const scored = remaining
      .map((candidate) => {
        const relevance = cosine(candidate.vector, center)
        const redundancy = Math.max(
          0,
          ...selected.map((item) => cosine(candidate.vector, item.vector))
        )
        return {
          candidate,
          score:
            DOCX_OUTLINE_MMR_RELEVANCE_WEIGHT * relevance -
            DOCX_OUTLINE_MMR_DIVERSITY_WEIGHT * redundancy
        }
      })
      .sort(
        (left, right) =>
          right.score - left.score || left.candidate.nodeIndex - right.candidate.nodeIndex
      )
    const viable = scored.find((item) => {
      if (item.score <= 0) return false
      if (selected.some((chosen) => chosen.nodeIndex === item.candidate.nodeIndex)) return false
      const rendered = `[${String(item.candidate.nodeIndex)}] ${item.candidate.text}`
      return used + charLength(rendered) + (selected.length > 0 ? 1 : 0) <= budget
    })
    if (!viable) {
      if (selected.length === 0) {
        const best = scored.find((item) => item.score > 0)
        if (best) {
          const prefix = `[${String(best.candidate.nodeIndex)}] `
          const text = truncateEnds(best.candidate.text, budget - charLength(prefix))
          if (text) selected.push({ ...best.candidate, text })
        }
      }
      break
    }
    selected.push(viable.candidate)
    used +=
      charLength(`[${String(viable.candidate.nodeIndex)}] ${viable.candidate.text}`) +
      (selected.length > 1 ? 1 : 0)
    remaining.splice(remaining.indexOf(viable.candidate), 1)
  }
  return selected
    .sort((left, right) => left.nodeIndex - right.nodeIndex)
    .map(({ nodeIndex, text }) => ({ nodeIndex, text }))
}

const buildIdf = (segments: DraftSegment[]): Map<string, number> => {
  const documents = segments
    .flatMap((segment) => segment.items.flatMap(splitSentences))
    .map((item) => tokenize(item.text))
  const documentFrequency = new Map<string, number>()
  documents.forEach((tokens) => {
    new Set(tokens).forEach((token) =>
      documentFrequency.set(token, (documentFrequency.get(token) || 0) + 1)
    )
  })
  const idf = new Map<string, number>()
  documentFrequency.forEach((frequency, token) => {
    idf.set(token, Math.log((documents.length + 1) / (frequency + 1)) + 1)
  })
  return idf
}

const buildTextMap = (segment: DraftSegment, idf: Map<string, number>): string => {
  const anchorText = segment.items
    .map((item) => item.anchor)
    .filter(Boolean)
    .join('；')
  const anchor = truncateEnds(anchorText, DOCX_OUTLINE_ANCHOR_MAX_CHARS)
  const fullText = segment.items.map((item) => item.text).join('\n')
  const keywords = selectKeywords(fullText, idf)
  const parts: string[] = []
  if (anchor) parts.push(`结构：${anchor}`)
  if (keywords) parts.push(`关键词：${keywords}`)
  const used = charLength(parts.join('\n')) + (parts.length > 0 ? 1 : 0) + charLength('代表句：')
  const candidates = segment.items
    .flatMap(splitSentences)
    .filter((item, index, all) => {
      const normalized = normalizeLexical(item.text)
      return (
        normalized.length > 0 &&
        all.findIndex((candidate) => normalizeLexical(candidate.text) === normalized) === index
      )
    })
    .map((item) => ({
      ...item,
      vector: vectorize(item.text, idf)
    }))
  const representatives = selectRepresentatives(
    candidates,
    Math.max(0, DOCX_OUTLINE_SEGMENT_MAP_MAX_CHARS - used)
  )
  if (representatives.length > 0) {
    parts.push(
      `代表句：${representatives.map((item) => `[${String(item.nodeIndex)}] ${item.text}`).join('\n')}`
    )
  }
  return takeChars(parts.join('\n'), DOCX_OUTLINE_SEGMENT_MAP_MAX_CHARS)
}

export const buildDocxSegmentMap = (
  index: NodeIndex,
  bundle?: Pick<ParsedDocxBundle, 'stylesDom'>
): DocxOutlineSegment[] => {
  const items = buildRootItems(index, bundle)
  const stories = new Map<string, RootItem[]>()
  items.forEach((item) => {
    const list = stories.get(item.node.story.storyId) || []
    list.push(item)
    stories.set(item.node.story.storyId, list)
  })
  const drafts = [...stories.values()].flatMap(segmentStory)
  const idf = buildIdf(drafts)
  return drafts.map((segment) => ({
    story: segment.story,
    fromNodeIndex: segment.items[0]!.node.nodeIndex,
    toNodeIndex: segment.items[segment.items.length - 1]!.node.nodeIndex,
    textMap: buildTextMap(segment, idf)
  }))
}
