import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { OfficeReviewIndex, ReviewRegion } from '../../../../shared/fileReview'
import type { ParsedDocxBundle } from '../human/tools/docx/adapters/ooxml/types'
import { REVIEW, W } from '../human/tools/docx/review/documentModel'

export const writeReviewIndex = async (
  directory: string,
  after: Buffer,
  regions: ReviewRegion[]
): Promise<void> => {
  const index: OfficeReviewIndex = {
    version: 1,
    afterChecksum: createHash('sha256').update(after).digest('hex'),
    regions
  }
  await fs.writeFile(path.join(directory, 'navigation.json'), JSON.stringify(index))
}
const textOf = (node: Element): string =>
  Array.from(node.getElementsByTagNameNS(W, 't'))
    .map((t) => t.textContent || '')
    .join('')
/** Attach provenance to the in-memory review copy, never the actual file. */
export const prepareDocxLocations = (
  working: ParsedDocxBundle
): Map<
  string,
  { part: string; paragraph: number; text: string; previous: string; next: string }
> => {
  const locations = new Map<
    string,
    { part: string; paragraph: number; text: string; previous: string; next: string }
  >()
  for (const part of working.stories.filter((p) => p.story.type !== 'textbox')) {
    const paragraphs = Array.from(part.root.getElementsByTagNameNS(W, 'p'))
    paragraphs.forEach((p, i) => {
      const id = `${part.partName}:${i + 1}`
      p.setAttributeNS(REVIEW, 'ncr:target', id)
      locations.set(id, {
        part: part.partName,
        paragraph: i + 1,
        text: textOf(p),
        previous: i ? textOf(paragraphs[i - 1]) : '',
        next: i + 1 < paragraphs.length ? textOf(paragraphs[i + 1]) : ''
      })
    })
  }
  return locations
}
export const collectDocxRegions = (
  working: ParsedDocxBundle,
  locations: ReturnType<typeof prepareDocxLocations>
): ReviewRegion[] => {
  const regions: ReviewRegion[] = []
  for (const part of working.stories.filter((p) => p.story.type !== 'textbox')) {
    const all = Array.from(part.root.getElementsByTagName('*'))
    const nextTargets: Array<Element | null> = Array(all.length).fill(null)
    const previousTargets: Array<Element | null> = Array(all.length).fill(null)
    let last: Element | null = null
    for (let i = all.length - 1; i >= 0; i--) {
      nextTargets[i] = last
      if (all[i].hasAttributeNS(REVIEW, 'target')) last = all[i]
    }
    last = null
    for (let i = 0; i < all.length; i++) {
      previousTargets[i] = last
      if (all[i].hasAttributeNS(REVIEW, 'target')) last = all[i]
    }
    for (let i = 0; i < all.length; i++) {
      const element = all[i]
      const change = element.getAttributeNS(REVIEW, 'change')
      if (!change) continue
      const id = `docx-${regions.length + 1}`
      element.setAttributeNS(REVIEW, 'ncr:region', id)
      let candidate: Element | null = element
      while (candidate && !candidate.getAttributeNS(REVIEW, 'target'))
        candidate = candidate.parentNode?.nodeType === 1 ? (candidate.parentNode as Element) : null
      if (!candidate)
        candidate =
          Array.from(element.getElementsByTagNameNS(W, 'p')).find((p) =>
            p.hasAttributeNS(REVIEW, 'target')
          ) || null
      const exact = Boolean(candidate)
      if (!candidate) candidate = nextTargets[i] || previousTargets[i]
      const location = candidate && locations.get(candidate.getAttributeNS(REVIEW, 'target') || '')
      regions.push({
        id,
        surface: part.partName,
        key: id,
        target: location
          ? {
              kind: 'docx',
              ...location,
              quote: change === 'deleted' ? '' : textOf(element),
              container: !exact || change === 'deleted' || element.localName !== 'r'
            }
          : null
      })
    }
  }
  return regions
}
export const pptSlideIdentities = async (bytes: Buffer): Promise<Map<string, number>> => {
  const zip = await JSZip.loadAsync(bytes),
    parser = new DOMParser()
  const xml = parser.parseFromString(
    await zip.file('ppt/presentation.xml')!.async('string'),
    'application/xml'
  )
  const rels = parser.parseFromString(
    await zip.file('ppt/_rels/presentation.xml.rels')!.async('string'),
    'application/xml'
  )
  const paths = new Map(
    Array.from(rels.getElementsByTagName('Relationship')).map((e) => [
      e.getAttribute('Id'),
      path.posix
        .normalize(
          (e.getAttribute('Target') || '').startsWith('/')
            ? e.getAttribute('Target') || ''
            : 'ppt/' + e.getAttribute('Target')
        )
        .replace(/^\//, '')
    ])
  )
  return new Map(
    Array.from(xml.getElementsByTagName('p:sldId')).map((e) => [
      paths.get(e.getAttribute('r:id')) || '',
      Number(e.getAttribute('id'))
    ])
  )
}
