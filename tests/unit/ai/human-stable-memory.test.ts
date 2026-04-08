import { describe, expect, it } from 'vitest'
import { applyStableMemoryPatch } from '../../../src/main/services/ai/human/memory/stableMemory'
import type { HumanStableMemory } from '../../../src/main/services/ai/human/types'

const BASE_STABLE_MEMORY: HumanStableMemory = {
  confirmedFacts: '已确认事实',
  keyEvidence: '关键依据',
  openQuestions: '未决问题'
}

describe('ai unit stable memory patch', () => {
  it('keeps the original stable memory when patch is missing', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY
      })
    ).toEqual(BASE_STABLE_MEMORY)
  })

  it('overwrites only the returned stable memory fields', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY,
        patch: {
          keyEvidence: '新的关键依据'
        }
      })
    ).toEqual({
      confirmedFacts: '已确认事实',
      keyEvidence: '新的关键依据',
      openQuestions: '未决问题'
    })
  })

  it('accepts an empty patch object as a no-op', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY,
        patch: {}
      })
    ).toEqual(BASE_STABLE_MEMORY)
  })

  it('clears a field when the patch explicitly returns an empty string', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY,
        patch: {
          openQuestions: ''
        }
      })
    ).toEqual({
      confirmedFacts: '已确认事实',
      keyEvidence: '关键依据',
      openQuestions: ''
    })
  })

  it('normalizes line endings and trims trailing whitespace for patched text', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY,
        patch: {
          confirmedFacts: '第一行  \r\n第二行\t \r\n'
        }
      })
    ).toEqual({
      confirmedFacts: '第一行\n第二行',
      keyEvidence: '关键依据',
      openQuestions: '未决问题'
    })
  })
})
