import { describe, expect, it } from 'vitest'
import { normalizeVisionModelAnalysisResult } from '../../../../src/main/services/llm/visionModelAnalysis'

describe('vision model analysis normalization', () => {
  it('keeps only supported models present in the candidate set and dedupes repeats', () => {
    const modelNames = normalizeVisionModelAnalysisResult(
      ['gpt-4o', 'gpt-4o-mini', 'qwen-vl-max'],
      {
        models: ['gpt-4o', 'gpt-4o', 'qwen-vl-max', 'ghost']
      }
    )

    expect(modelNames).toEqual(['gpt-4o', 'qwen-vl-max'])
  })

  it('drops blank names and names outside the candidate set', () => {
    const modelNames = normalizeVisionModelAnalysisResult(['model-a'], {
      models: ['model-a', 'model-b', '  ']
    })

    expect(modelNames).toEqual(['model-a'])
  })
})
