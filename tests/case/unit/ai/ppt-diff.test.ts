import { describe, expect, it } from 'vitest'

import {
  buildPptDiffManifest,
  diffPptElements,
  resolveMovedPptSlideIds
} from '../../../../src/main/services/ai/human/tools/ppt/diff'
import type {
  PptDiffElementSnapshot,
  PptDiffSlideSnapshot
} from '../../../../src/main/services/ai/human/tools/ppt/types'

const element = (elementId: string, fingerprint: string, zIndex = 0): PptDiffElementSnapshot => ({
  elementId,
  fingerprint,
  zIndex
})

const slide = (
  slideId: string,
  index: number,
  elements: PptDiffElementSnapshot[] = [],
  pageFingerprint = 'page'
): PptDiffSlideSnapshot => ({ slideId, index, elements, pageFingerprint })

const manifest = (input: {
  before: PptDiffSlideSnapshot[]
  after: PptDiffSlideSnapshot[]
  movedCandidates?: Set<string>
  movedElementCandidates?: Set<string>
  lineage?: Map<string, string>
}) =>
  buildPptDiffManifest({
    beforeSlides: input.before,
    afterSlides: input.after,
    beforeFrames: new Map(),
    afterFrames: new Map(),
    operation: 'updated',
    movedCandidates: input.movedCandidates,
    movedElementCandidates: input.movedElementCandidates,
    elementLineage: input.lineage
  })

describe('ppt net diff', () => {
  it('does not mark later slides as moved after middle insertion or deletion', () => {
    expect(
      resolveMovedPptSlideIds({
        beforeSlideIds: ['A', 'B', 'C', 'D'],
        afterSlideIds: ['A', 'C', 'D']
      })
    ).toEqual(new Set())
    expect(
      resolveMovedPptSlideIds({
        beforeSlideIds: ['A', 'B', 'C', 'D'],
        afterSlideIds: ['A', 'X', 'B', 'C', 'D']
      })
    ).toEqual(new Set())
  })

  it('marks only the explicitly moved slide and collapses a move restored to baseline', () => {
    expect(
      resolveMovedPptSlideIds({
        beforeSlideIds: ['A', 'B', 'C', 'D'],
        afterSlideIds: ['B', 'C', 'A', 'D'],
        movedCandidates: new Set(['A'])
      })
    ).toEqual(new Set(['A']))
    expect(
      resolveMovedPptSlideIds({
        beforeSlideIds: ['A', 'B', 'C'],
        afterSlideIds: ['A', 'B', 'C'],
        movedCandidates: new Set(['A'])
      })
    ).toEqual(new Set())
  })

  it('uses stable ids, replacement lineage, and exact fingerprints for element matching', () => {
    expect(
      diffPptElements({
        before: [element('same', 'A'), element('formula-old', 'B'), element('renumbered-old', 'C')],
        after: [
          element('same', 'A2'),
          element('formula-new', 'B2'),
          element('renumbered-new', 'C')
        ],
        lineage: new Map([['formula-old', 'formula-new']])
      })
    ).toEqual([
      { kind: 'modified', beforeElementId: 'same', afterElementId: 'same' },
      {
        kind: 'modified',
        beforeElementId: 'formula-old',
        afterElementId: 'formula-new'
      }
    ])
  })

  it('counts element additions, deletions, modifications, and slide movement as net changes', () => {
    const result = manifest({
      before: [slide('A', 1, [element('keep', 'old'), element('delete', 'old')])],
      after: [slide('A', 1, [element('keep', 'new'), element('add', 'new')])],
      movedCandidates: new Set(['A'])
    })
    expect(result.slides[0]).toMatchObject({
      changes: ['modified'],
      positiveCount: 2,
      negativeCount: 1
    })
    expect({ positive: result.positiveCount, negative: result.negativeCount }).toEqual({
      positive: 2,
      negative: 1
    })

    const movedAndModified = manifest({
      before: [slide('A', 1, [element('one', 'old'), element('two', 'old')]), slide('B', 2)],
      after: [slide('B', 1), slide('A', 2, [element('one', 'new'), element('two', 'new')])],
      movedCandidates: new Set(['A'])
    })
    expect(movedAndModified.slides.find((item) => item.slideId === 'A')).toMatchObject({
      changes: ['modified', 'moved'],
      positiveCount: 3,
      negativeCount: 0
    })
  })

  it('collapses restored edits and temporary elements to zero net changes', () => {
    const result = manifest({
      before: [slide('A', 1, [element('one', 'baseline')])],
      after: [slide('A', 1, [element('one', 'baseline')])],
      movedCandidates: new Set(['A'])
    })
    expect(result.slides[0]).toMatchObject({
      changed: false,
      changes: [],
      elementChanges: [],
      positiveCount: 0,
      negativeCount: 0
    })
    expect(result.positiveCount + result.negativeCount).toBe(0)
  })

  it('counts page-level background or notes fingerprints once and collapses restoration', () => {
    const changed = manifest({
      before: [slide('A', 1, [], 'page-before')],
      after: [slide('A', 1, [], 'page-after')]
    })
    expect(changed.slides[0]).toMatchObject({
      changes: ['modified'],
      positiveCount: 1,
      negativeCount: 0
    })

    const restored = manifest({
      before: [slide('A', 1, [], 'same-page')],
      after: [slide('A', 1, [], 'same-page')]
    })
    expect(restored.positiveCount + restored.negativeCount).toBe(0)
  })

  it('counts only the element explicitly moved in z-order and ignores natural renumbering', () => {
    expect(
      diffPptElements({
        before: [element('A', 'same', 0), element('B', 'same', 1), element('C', 'same', 2)],
        after: [element('B', 'same', 0), element('C', 'same', 1), element('A', 'same', 2)],
        movedCandidates: new Set(['A'])
      })
    ).toEqual([{ kind: 'modified', beforeElementId: 'A', afterElementId: 'A' }])

    expect(
      diffPptElements({
        before: [element('A', 'same', 0), element('B', 'same', 1), element('C', 'same', 2)],
        after: [element('A', 'same', 0), element('C', 'same', 1)]
      })
    ).toEqual([{ kind: 'deleted', beforeElementId: 'B' }])
  })

  it('subsumes child elements when an entire slide is added or deleted', () => {
    const result = manifest({
      before: [slide('deleted', 1, [element('old-1', 'A'), element('old-2', 'B')])],
      after: [slide('added', 1, [element('new-1', 'A'), element('new-2', 'B')])]
    })
    expect(
      result.slides.map((item) => [item.changes, item.positiveCount, item.negativeCount])
    ).toEqual([
      [['deleted'], 0, 1],
      [['added'], 1, 0]
    ])
  })
})
