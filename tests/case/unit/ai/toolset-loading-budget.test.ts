import { describe, expect, it } from 'vitest'
import {
  countActiveToolNamesForToolsetIds,
  fitToolsetIdsToToolBudget
} from '../../../../src/main/services/ai/human/node/toolsetLoadingNode/toolBudget'

type FakeToolsetId = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta'

const FAKE_TOOLSET_TOOLS: Record<FakeToolsetId, readonly string[]> = {
  alpha: ['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', 'tool-7', 'tool-8'],
  beta: ['tool-9', 'tool-10', 'tool-11', 'tool-12', 'tool-13', 'tool-14', 'tool-15', 'tool-16'],
  gamma: ['tool-17', 'tool-18', 'tool-19', 'tool-20', 'tool-21'],
  delta: ['tool-22', 'tool-23', 'tool-24', 'tool-25'],
  epsilon: [
    'tool-26',
    'tool-27',
    'tool-28',
    'tool-29',
    'tool-30',
    'tool-31',
    'tool-32',
    'tool-33',
    'tool-34',
    'tool-35',
    'tool-36',
    'tool-37'
  ],
  zeta: [
    'tool-38',
    'tool-39',
    'tool-40',
    'tool-41',
    'tool-42',
    'tool-43',
    'tool-44',
    'tool-45',
    'tool-46',
    'tool-47',
    'tool-48',
    'tool-49'
  ]
}

const getFakeToolNames = (toolsetId: FakeToolsetId): readonly string[] =>
  FAKE_TOOLSET_TOOLS[toolsetId]

describe('ai unit toolset loading tool budget', () => {
  it('counts unique active tool names across loaded toolsets', () => {
    const count = countActiveToolNamesForToolsetIds({
      toolsetIds: ['alpha', 'alpha', 'beta'],
      getToolNames: getFakeToolNames
    })

    expect(count).toBe(16)
  })

  it('includes builtin tools and evicts whole toolsets in FIFO order', () => {
    const builtinToolNames = Array.from({ length: 12 }, (_, index) => `builtin-${index + 1}`)
    const result = fitToolsetIdsToToolBudget({
      existingToolsetIds: ['alpha', 'beta'],
      requestedToolsetIds: ['delta'],
      maxActiveTools: 25,
      baseToolNames: builtinToolNames,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: true,
      loadedToolsetIds: ['beta', 'delta'],
      evictedToolsetIds: ['alpha'],
      activeToolCount: 24
    })
  })

  it('evicts oldest previously loaded toolsets to preserve newly requested toolsets under tool budget', () => {
    const result = fitToolsetIdsToToolBudget({
      existingToolsetIds: ['alpha', 'beta', 'gamma'],
      requestedToolsetIds: ['delta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: true,
      loadedToolsetIds: ['beta', 'gamma', 'delta'],
      evictedToolsetIds: ['alpha'],
      activeToolCount: 17
    })
  })

  it('fails when the newly requested toolsets alone exceed the active tool budget', () => {
    const result = fitToolsetIdsToToolBudget({
      existingToolsetIds: ['alpha'],
      requestedToolsetIds: ['epsilon', 'zeta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: false,
      activeToolCount: 24,
      requestedToolsetIds: ['epsilon', 'zeta']
    })
  })
})
