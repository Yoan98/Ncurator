import { describe, expect, it } from 'vitest'
import { applyStableMemoryPatch } from '../../../src/main/services/ai/human/memory/stableMemory'
import type { HumanStableMemory } from '../../../src/main/services/ai/human/types'

const BASE_STABLE_MEMORY: HumanStableMemory = {
  currentUnderstanding: '当前理解',
  keyEvidence: '关键依据',
  checklist: '- [todo] 继续核对\n  - note: 还没完成'
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
      currentUnderstanding: '当前理解',
      keyEvidence: '新的关键依据',
      checklist: '- [todo] 继续核对\n  - note: 还没完成'
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
          checklist: ''
        }
      })
    ).toEqual({
      currentUnderstanding: '当前理解',
      keyEvidence: '关键依据',
      checklist: ''
    })
  })

  it('normalizes line endings and trims trailing whitespace for patched text', () => {
    expect(
      applyStableMemoryPatch({
        stable: BASE_STABLE_MEMORY,
        patch: {
          currentUnderstanding: '第一行  \r\n第二行\t \r\n'
        }
      })
    ).toEqual({
      currentUnderstanding: '第一行\n第二行',
      keyEvidence: '关键依据',
      checklist: '- [todo] 继续核对\n  - note: 还没完成'
    })
  })
})
