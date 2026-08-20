import { describe, expect, it } from 'vitest'
import type { AiVisionModelCandidate } from '../../../../src/shared/types'
import {
  clampCostTier,
  normalizeVisionModelAnalysisResult
} from '../../../../src/main/services/llm/visionModelAnalysis'

const candidate = (configId: string, modelId: string): AiVisionModelCandidate => ({
  configId,
  configName: `config ${configId}`,
  modelId
})

describe('vision model analysis normalization', () => {
  it('clamps cost tier to the 1-3 range', () => {
    expect(clampCostTier(0)).toBe(1)
    expect(clampCostTier(-5)).toBe(1)
    expect(clampCostTier(1)).toBe(1)
    expect(clampCostTier(1.4)).toBe(1)
    expect(clampCostTier(1.5)).toBe(2)
    expect(clampCostTier(2)).toBe(2)
    expect(clampCostTier(2.6)).toBe(3)
    expect(clampCostTier(3)).toBe(3)
    expect(clampCostTier(99)).toBe(3)
  })

  it('keeps only models present in the candidate set and dedupes repeats', () => {
    const candidates = [candidate('cfg-1', 'gpt-4o'), candidate('cfg-1', 'gpt-4o-mini')]
    const items = normalizeVisionModelAnalysisResult(candidates, {
      models: [
        { configId: 'cfg-1', modelId: 'gpt-4o', isVision: true, costTier: 2 },
        { configId: 'cfg-1', modelId: 'gpt-4o', isVision: true, costTier: 3 },
        { configId: 'cfg-1', modelId: 'gpt-4o-mini', isVision: false, costTier: 1 },
        { configId: 'cfg-unknown', modelId: 'ghost', isVision: true, costTier: 3 }
      ]
    })

    expect(items).toEqual([
      { configId: 'cfg-1', modelId: 'gpt-4o', isVision: true, costTier: 2 },
      { configId: 'cfg-1', modelId: 'gpt-4o-mini', isVision: false, costTier: 1 }
    ])
  })

  it('clamps out-of-range cost tier values returned by the model', () => {
    const candidates = [candidate('cfg-1', 'model-a')]
    const items = normalizeVisionModelAnalysisResult(candidates, {
      models: [
        { configId: 'cfg-1', modelId: 'model-a', isVision: true, costTier: 0 },
        { configId: 'cfg-1', modelId: 'model-b', isVision: true, costTier: 10 }
      ]
    })

    expect(items).toEqual([{ configId: 'cfg-1', modelId: 'model-a', isVision: true, costTier: 1 }])
  })
})
