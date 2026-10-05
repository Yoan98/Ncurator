import { diffArrays } from 'diff'
import { childElements, firstChildElement } from '../adapters/ooxml/dom'
import {
  assetHashes,
  canonical,
  hash,
  R,
  numberingMap,
  parseXml,
  styleMap,
  themeMap,
  W
} from './documentModel'
import { SourceImporter } from './sourceImporter'
import type { DocumentContext } from './documentModel'
import { graphemes, markElement, paragraphContentKey, renderParagraphDiff } from './inlineDiff'
import { resolveDocxRelationshipTarget } from '../adapters/ooxml/relationshipPath'
import type { ParsedDocxBundle } from '../adapters/ooxml/types'

export type DocxNetStats = { changeCount: number; insertCount: number; deleteCount: number }
export type DocxNetReview = { stats: DocxNetStats; summaries: string[] }
const emptyStats = (): DocxNetStats => ({ changeCount: 0, insertCount: 0, deleteCount: 0 })
const accumulate = (target: DocxNetStats, delta: DocxNetStats): void => {
  target.changeCount += delta.changeCount
  target.insertCount += delta.insertCount
  target.deleteCount += delta.deleteCount
}
const contentKey = (element: Element, context: DocumentContext): string => {
  if (element.localName === 'p') return `p:${paragraphContentKey(element, context)}`
  if (['tbl', 'tr', 'tc', 'sdt', 'sdtContent'].includes(element.localName))
    return `${element.localName}:${JSON.stringify(
      childElements(element)
        .filter((e) => !['tblPr', 'tblGrid', 'trPr', 'tcPr', 'sdtPr'].includes(e.localName))
        .map((e) => contentKey(e, context))
    )}`
  return canonical(element, context)
}
const plainText = (element: Element): string =>
  Array.from(element.getElementsByTagNameNS(W, 't'))
    .map((t) => t.textContent || '')
    .join('')

/** Match content before aligning order. Runtime identities and edit operations are absent. */
const matchBlocks = (
  before: Element[],
  after: Element[],
  oldContext: DocumentContext,
  newContext: DocumentContext
): Map<number, number> => {
  const keysBefore = before.map((e) => contentKey(e, oldContext)),
    keysAfter = after.map((e) => contentKey(e, newContext))
  const matches = new Map<number, number>(),
    consumed = new Set<number>()
  let left = 0,
    right = 0
  for (const chunk of diffArrays(keysBefore, keysAfter)) {
    if (chunk.removed) left += chunk.count!
    else if (chunk.added) right += chunk.count!
    else
      for (let i = 0; i < chunk.count!; i++) {
        matches.set(left++, right)
        consumed.add(right++)
      }
  }
  for (let i = 0; i < before.length; i++) {
    if (matches.has(i)) continue
    const j = keysAfter.findIndex((key, index) => !consumed.has(index) && key === keysBefore[i])
    if (j >= 0) {
      matches.set(i, j)
      consumed.add(j)
    }
  }
  const candidates: Array<{ i: number; j: number; score: number }> = []
  const profile = (element: Element): { length: number; counts: Map<string, number> } => {
    const chars = graphemes(plainText(element)),
      counts = new Map<string, number>()
    for (const char of chars) counts.set(char, (counts.get(char) || 0) + 1)
    return { length: chars.length, counts }
  }
  const oldProfiles = before.map(profile),
    newProfiles = after.map(profile)
  for (let i = 0; i < before.length; i++) {
    if (matches.has(i)) continue
    const text = oldProfiles[i]!
    for (let j = 0; j < after.length; j++) {
      if (consumed.has(j) || before[i]!.localName !== after[j]!.localName) continue
      const other = newProfiles[j]!
      if (!text.length || !other.length) continue
      let common = 0
      for (const [char, count] of text.counts)
        common += Math.min(count, other.counts.get(char) || 0)
      const score = (2 * common) / (text.length + other.length)
      if (score >= 0.5) candidates.push({ i, j, score })
    }
  }
  candidates.sort(
    (a, b) =>
      b.score - a.score || Math.abs(a.i - a.j) - Math.abs(b.i - b.j) || a.i - b.i || a.j - b.j
  )
  for (const { i, j } of candidates)
    if (!matches.has(i) && !consumed.has(j)) {
      matches.set(i, j)
      consumed.add(j)
    }
  const anchors: Array<[number, number]> = [[-1, -1]]
  for (const pair of [...matches].sort(([a], [b]) => a - b))
    if (pair[1] > anchors.at(-1)![1]) anchors.push(pair)
  anchors.push([before.length, after.length])
  for (let n = 1; n < anchors.length; n++) {
    const [oldStart, newStart] = anchors[n - 1]!,
      [oldEnd, newEnd] = anchors[n]!
    const oldGap = before
      .map((_, i) => i)
      .filter((i) => i > oldStart && i < oldEnd && !matches.has(i))
    const newGap = after
      .map((_, j) => j)
      .filter((j) => j > newStart && j < newEnd && !consumed.has(j))
    if (oldGap.length !== newGap.length) continue
    for (let i = 0; i < oldGap.length; i++) {
      const oldIndex = oldGap[i]!,
        newIndex = newGap[i]!
      if (before[oldIndex]!.localName === after[newIndex]!.localName) {
        matches.set(oldIndex, newIndex)
        consumed.add(newIndex)
      }
    }
  }
  return matches
}
const propertyKey = (element: Element, names: string[], context: DocumentContext): string =>
  JSON.stringify(
    names.map((name) => {
      const prop = firstChildElement(element, name)
      if (!prop) return ''
      const copy = prop.cloneNode(true) as Element
      const tableStyle = firstChildElement(copy, 'tblStyle')
      if (tableStyle) {
        const style = context.styles.get(tableStyle.getAttribute('w:val') || '')
        tableStyle.setAttribute(
          'w:val',
          style
            ? JSON.stringify(
                childElements(style)
                  .filter((e) =>
                    ['pPr', 'rPr', 'tblPr', 'trPr', 'tcPr', 'tblStylePr'].includes(e.localName)
                  )
                  .map((e) => canonical(e, context))
              )
            : ''
        )
      }
      return canonical(copy, context)
    })
  )

type BlockResult = { elements: Element[]; stats: DocxNetStats }
const replacement = (before: Element, after: Element): BlockResult => {
  const old = before.cloneNode(true) as Element,
    next = after.cloneNode(true) as Element
  markElement(old, 'deleted')
  markElement(next, 'inserted')
  return { elements: [old, next], stats: { changeCount: 1, insertCount: 1, deleteCount: 1 } }
}
const renderPair = (
  before: Element,
  after: Element,
  oldContext: DocumentContext,
  newContext: DocumentContext,
  forceFormat: boolean
): BlockResult => {
  const stats = emptyStats()
  if (after.localName === 'p') {
    const inline = renderParagraphDiff(before, after, oldContext, newContext, forceFormat)
    if (inline.textChanged) {
      stats.changeCount = 1
      stats.insertCount = 1
      stats.deleteCount = 1
    } else if (inline.formatChanged) stats.changeCount = 1
    return { elements: [inline.element], stats }
  }
  const containers: Record<string, { children: string; properties: string[] }> = {
    tbl: { children: 'tr', properties: ['tblPr'] },
    tr: { children: 'tc', properties: ['trPr'] },
    tc: { children: '', properties: ['tcPr'] },
    sdt: { children: 'sdtContent', properties: ['sdtPr'] },
    sdtContent: { children: '', properties: [] }
  }
  const container = containers[after.localName]
  if (container) {
    if (after.localName === 'tr') {
      // Merges/splits alter topology: preserve each complete original/final row.
      const spans = (row: Element): string =>
        JSON.stringify(
          childElements(row, 'tc').map((cell) =>
            childElements(
              firstChildElement(cell, 'tcPr') || cell.ownerDocument.createElement('empty')
            )
              .filter((e) => ['gridSpan', 'vMerge', 'hMerge'].includes(e.localName))
              .map((e) => canonical(e))
          )
        )
      if (
        spans(before) !== spans(after) &&
        /gridSpan|vMerge|hMerge/.test(spans(before) + spans(after))
      )
        return replacement(before, after)
    }
    const propertiesChanged =
      propertyKey(before, container.properties, oldContext) !==
      propertyKey(after, container.properties, newContext)
    const children = (node: Element): Element[] =>
      childElements(node).filter((e) =>
        container.children
          ? e.localName === container.children
          : !container.properties.includes(e.localName)
      )
    const result = after.cloneNode(true) as Element
    const comparison = compareBlocks(
      children(before),
      children(after),
      oldContext,
      newContext,
      forceFormat || propertiesChanged
    )
    children(result).forEach((e) => result.removeChild(e))
    comparison.elements.forEach((e) => result.appendChild(e))
    accumulate(stats, comparison.stats)
    if (after.localName === 'tc' && stats.changeCount) {
      stats.changeCount = 1
      stats.insertCount = stats.insertCount ? 1 : 0
      stats.deleteCount = stats.deleteCount ? 1 : 0
    }
    if (propertiesChanged || forceFormat) {
      markElement(result, 'formatted', !!before.getElementsByTagNameNS(W, 'shd').length)
      if (!stats.insertCount && !stats.deleteCount) stats.changeCount = 1
      else if (!stats.changeCount) stats.changeCount = 1
    }
    // Grid widths are format; different column count belongs to the cell topology.
    if (after.localName === 'tbl') {
      const oldGrid = firstChildElement(before, 'tblGrid'),
        newGrid = firstChildElement(after, 'tblGrid')
      if (
        oldGrid &&
        newGrid &&
        childElements(oldGrid).length === childElements(newGrid).length &&
        canonical(oldGrid) !== canonical(newGrid)
      ) {
        markElement(result, 'formatted', !!before.getElementsByTagNameNS(W, 'shd').length)
        if (!stats.changeCount) stats.changeCount = 1
      }
    }
    return { elements: [result], stats }
  }
  if (canonical(before, oldContext) === canonical(after, newContext))
    return { elements: [after.cloneNode(true) as Element], stats }
  // Opaque objects and existing revisions stay intact. Never invent a text mapping.
  return replacement(before, after)
}

export const compareBlocks = (
  before: Element[],
  after: Element[],
  oldContext: DocumentContext,
  newContext: DocumentContext,
  forceFormat: boolean | ReadonlySet<Element> = false
): { elements: Element[]; stats: DocxNetStats } => {
  const matches = matchBlocks(before, after, oldContext, newContext),
    reverse = new Map([...matches].map(([i, j]) => [j, i]))
  const oldIds = before.map((_, i) => `old:${i}`),
    newIds = after.map((_, j) => (reverse.has(j) ? `old:${reverse.get(j)}` : `new:${j}`))
  const chunks = diffArrays(oldIds, newIds),
    moved = new Set<string>()
  for (const chunk of chunks)
    if (chunk.removed) for (const id of chunk.value) if (newIds.includes(id)) moved.add(id)
  const elements: Element[] = [],
    stats = emptyStats()
  let oldIndex = 0,
    newIndex = 0
  for (const chunk of chunks) {
    if (chunk.removed)
      for (let count = 0; count < chunk.count!; count++) {
        const i = oldIndex++,
          element = before[i]!.cloneNode(true) as Element
        markElement(element, 'deleted')
        elements.push(element)
        stats.deleteCount++
        if (!moved.has(oldIds[i]!)) stats.changeCount++
      }
    else if (chunk.added)
      for (let count = 0; count < chunk.count!; count++) {
        const element = after[newIndex++]!.cloneNode(true) as Element
        markElement(element, 'inserted')
        elements.push(element)
        stats.insertCount++
        stats.changeCount++
      }
    else
      for (let count = 0; count < chunk.count!; count++) {
        const pair = renderPair(
          before[oldIndex++]!,
          after[newIndex++]!,
          oldContext,
          newContext,
          typeof forceFormat === 'boolean' ? forceFormat : forceFormat.has(after[newIndex - 1]!)
        )
        elements.push(...pair.elements)
        accumulate(stats, pair.stats)
      }
  }
  return { elements, stats }
}
const packageKeys = async (
  bundle: ParsedDocxBundle,
  storyNames: Set<string>,
  resourceNames: Set<string>
): Promise<Map<string, string>> => {
  const keys = new Map<string, string>()
  for (const name of Object.keys(bundle.zip.files).sort()) {
    if (
      storyNames.has(name) ||
      resourceNames.has(name) ||
      name.endsWith('.rels') ||
      name === '[Content_Types].xml' ||
      bundle.zip.files[name]!.dir
    )
      continue
    const file = bundle.zip.file(name)
    if (!file) continue
    if (!name.endsWith('.xml')) {
      keys.set(name, hash(await file.async('nodebuffer')))
      continue
    }
    const xml = parseXml(await file.async('text'))
    if (
      ['word/comments.xml', 'word/commentsExtended.xml', 'word/settings.xml'].includes(name) &&
      !childElements(xml.documentElement).length
    )
      continue
    keys.set(name, hash(canonical(xml.documentElement)))
  }
  return keys
}
export const buildDocxNetReview = async (
  source: ParsedDocxBundle,
  working: ParsedDocxBundle,
  created = false
): Promise<DocxNetReview> => {
  const oldAssets = await assetHashes(source),
    newAssets = await assetHashes(working),
    oldStyles = styleMap(source),
    newStyles = styleMap(working)
  const storyNames = new Set([...source.stories, ...working.stories].map((p) => p.partName))
  const resourceNames = new Set<string>()
  for (const bundle of [source, working])
    for (const story of bundle.stories)
      for (const element of [story.root, ...Array.from(story.root.getElementsByTagName('*'))])
        for (const attr of Array.from(element.attributes)) {
          if (
            attr.namespaceURI !== R ||
            story.relationshipTargetModes.get(attr.value) === 'External'
          )
            continue
          const target = resolveDocxRelationshipTarget(
            story.relationshipTargets.get(attr.value) || '',
            story.partName
          )
          if (target && !storyNames.has(target)) resourceNames.add(target)
        }
  const oldPackage = await packageKeys(source, storyNames, resourceNames),
    newPackage = await packageKeys(working, storyNames, resourceNames)
  const oldTheme = await themeMap(source),
    newTheme = await themeMap(working),
    usedThemes = new Set<string>()
  const oldNumbering = await numberingMap(source),
    newNumbering = await numberingMap(working)
  const originalStyles = new Map(oldStyles),
    originalNumbering = new Map(oldNumbering)
  const importer = new SourceImporter(source, working),
    stats = emptyStats(),
    summaries: string[] = []
  const contexts = (
    part: (typeof source.stories)[number],
    bundle: ParsedDocxBundle,
    assets: Map<string, string>,
    styles: Map<string, Element>
  ): DocumentContext => ({
    part,
    bundle,
    assets,
    styles,
    numbering: bundle === source ? oldNumbering : newNumbering,
    theme: bundle === source ? oldTheme : newTheme,
    usedThemes
  })
  if (!created) await importer.prepareDefinitions(oldStyles, oldNumbering)
  for (const part of working.stories.filter((p) => p.story.type !== 'textbox')) {
    const original = source.stories.find((p) => p.story.storyId === part.story.storyId)
    const oldContext = contexts(original || part, source, oldAssets, oldStyles),
      newContext = contexts(part, working, newAssets, newStyles)
    const originalElements =
        created || !original
          ? []
          : childElements(original.root).filter((e) => e.localName !== 'sectPr'),
      before: Element[] = []
    for (const element of originalElements)
      before.push(await importer.importElement(element, original!, part))
    const after = childElements(part.root).filter((e) => e.localName !== 'sectPr')
    const oldSection = original && firstChildElement(original.root, 'sectPr'),
      section = firstChildElement(part.root, 'sectPr')
    const sections = (
      elements: Element[],
      terminal: Element | null
    ): Array<{ definition: Element | null; contents: Element[] }> => {
      const ranges: Array<{ definition: Element | null; contents: Element[] }> = []
      let contents: Element[] = []
      for (const element of elements) {
        contents.push(element)
        const props = firstChildElement(element, 'pPr'),
          definition = props && firstChildElement(props, 'sectPr')
        if (definition) {
          ranges.push({ definition, contents })
          contents = []
        }
      }
      ranges.push({ definition: terminal, contents })
      return ranges
    }
    const oldRanges = sections(before, oldSection || null),
      newRanges = sections(after, section || null)
    const formatTargets = new Set<Element>()
    let sectionChanged = false
    if (!created)
      newRanges.forEach((range, index) => {
        const old = oldRanges[index]
        if (
          canonical(old?.definition || source.documentDom.createElement('empty'), oldContext) !==
          canonical(range.definition || working.documentDom.createElement('empty'), newContext)
        ) {
          sectionChanged = true
          range.contents.forEach((e) => formatTargets.add(e))
        }
      })
    const result = compareBlocks(before, after, oldContext, newContext, formatTargets)
    accumulate(stats, result.stats)
    if (sectionChanged && !result.stats.changeCount) stats.changeCount++
    after.forEach((e) => part.root.removeChild(e))
    for (const element of result.elements) part.root.insertBefore(element, section || null)
  }
  for (const story of source.stories.filter((p) => p.story.type !== 'textbox'))
    if (!working.stories.some((p) => p.story.storyId === story.story.storyId)) {
      const count = childElements(story.root).filter((e) => e.localName !== 'sectPr').length
      stats.changeCount += count || 1
      stats.deleteCount += count
      summaries.push(story.partName)
    }
  const changedParts = new Set(
    created
      ? []
      : [...oldPackage.keys(), ...newPackage.keys()].filter(
          (name) => oldPackage.get(name) !== newPackage.get(name)
        )
  )
  for (const name of changedParts) {
    if (name === 'word/styles.xml' && stats.changeCount) {
      const used = new Set<string>()
      for (const bundle of [source, working])
        for (const story of bundle.stories) {
          for (const prop of Array.from(story.root.getElementsByTagName('*')))
            if (['pStyle', 'rStyle', 'tblStyle'].includes(prop.localName))
              used.add(prop.getAttribute('w:val') || '')
          if (story.root.getElementsByTagNameNS(W, 'p').length)
            for (const style of (bundle === source ? originalStyles : newStyles).values())
              if (style.getAttribute('w:default') === '1')
                used.add(style.getAttribute('w:styleId') || '')
        }
      for (const id of used)
        for (const map of [originalStyles, newStyles]) {
          let style = map.get(id),
            depth = 0
          while (style && depth++ < 100) {
            const base = firstChildElement(style, 'basedOn')
            if (!base) break
            const id = base.getAttribute('w:val') || ''
            used.add(id)
            style = map.get(id)
          }
        }
      const changedIds = [...new Set([...originalStyles.keys(), ...newStyles.keys()])].filter(
        (id) => {
          const a = originalStyles.get(id),
            b = newStyles.get(id)
          return (a ? canonical(a) : '') !== (b ? canonical(b) : '')
        }
      )
      const nonFormat = (style: Element | undefined): string =>
        style
          ? JSON.stringify(
              childElements(style)
                .filter((e) => !['pPr', 'rPr', 'basedOn'].includes(e.localName))
                .map((e) => canonical(e))
            )
          : ''
      if (
        changedIds.length &&
        changedIds.every(
          (id) => used.has(id) && nonFormat(originalStyles.get(id)) === nonFormat(newStyles.get(id))
        )
      )
        continue
      if (!changedIds.length) continue // docDefaults are already included in effective properties.
    }
    if (name.startsWith('word/theme/') && stats.changeCount) {
      const changed = [...new Set([...oldTheme.keys(), ...newTheme.keys()])].filter(
        (key) =>
          !['dark1', 'light1', 'dark2', 'light2'].includes(key) &&
          oldTheme.get(key)?.fingerprint !== newTheme.get(key)?.fingerprint
      )
      if (changed.length && changed.every((key) => usedThemes.has(key))) continue
    }
    if (name === 'word/numbering.xml' && stats.changeCount) {
      const used = new Set<string>()
      for (const bundle of [source, working])
        for (const story of bundle.stories)
          for (const node of Array.from(story.root.getElementsByTagNameNS(W, 'numId')))
            used.add(node.getAttribute('w:val') || '')
      const changed = [...new Set([...originalNumbering.keys(), ...newNumbering.keys()])].filter(
        (id) => originalNumbering.get(id) !== newNumbering.get(id)
      )
      if (changed.every((id) => used.has(id))) continue
    }
    stats.changeCount++
    summaries.push(name)
  }
  if (created && !stats.changeCount) stats.changeCount = 1
  importer.flush()
  return { stats, summaries }
}
