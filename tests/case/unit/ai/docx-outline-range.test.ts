import { describe, expect, it } from 'vitest'
import {
  countOutlineRootNodes,
  resolveOutlinePercentNodeRange,
  selectOutlineSegmentsForNodeRange
} from '../../../../src/main/services/ai/human/tools/docx/outlineRange'

describe('ai unit docx outline percent range', () => {
  it('maps percent onto root node indices like ppt outline', () => {
    expect(
      resolveOutlinePercentNodeRange({ fromPercent: 0, toPercent: 100, totalRootCount: 720 })
    ).toEqual({ fromNodeIndex: 0, toNodeIndex: 719 })
    expect(
      resolveOutlinePercentNodeRange({ fromPercent: 90, toPercent: 100, totalRootCount: 720 })
    ).toEqual({ fromNodeIndex: 648, toNodeIndex: 719 })
    expect(
      resolveOutlinePercentNodeRange({ fromPercent: 100, toPercent: 100, totalRootCount: 720 })
    ).toEqual({ fromNodeIndex: 719, toNodeIndex: 719 })
    expect(
      resolveOutlinePercentNodeRange({ fromPercent: 0, toPercent: 0, totalRootCount: 720 })
    ).toEqual({ fromNodeIndex: 0, toNodeIndex: 0 })
    expect(
      resolveOutlinePercentNodeRange({ fromPercent: 0, toPercent: 100, totalRootCount: 0 })
    ).toBeUndefined()
  })

  it('returns complete overlapping segments and counts roots without gaps', () => {
    const segments = [
      { fromNodeIndex: 0, toNodeIndex: 19 },
      { fromNodeIndex: 20, toNodeIndex: 39 },
      { fromNodeIndex: 40, toNodeIndex: 40 }
    ]
    expect(countOutlineRootNodes(segments)).toBe(41)
    expect(
      selectOutlineSegmentsForNodeRange(segments, { fromNodeIndex: 18, toNodeIndex: 22 })
    ).toEqual([
      { fromNodeIndex: 0, toNodeIndex: 19 },
      { fromNodeIndex: 20, toNodeIndex: 39 }
    ])
  })
})
