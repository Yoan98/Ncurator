import { z } from 'zod/v4'
import type { AiVisionModelAnalysisItem, AiVisionModelCandidate } from '../../../shared/types'

export const visionModelAnalysisSchema = z.object({
  models: z.array(
    z.object({
      configId: z.string(),
      modelId: z.string(),
      isVision: z.boolean(),
      costTier: z.number().int().min(1).max(3)
    })
  )
})

export type VisionModelAnalysisOutput = z.infer<typeof visionModelAnalysisSchema>

export const clampCostTier = (value: number): AiVisionModelAnalysisItem['costTier'] => {
  const rounded = Math.round(value)
  if (rounded <= 1) return 1
  if (rounded >= 3) return 3
  return 2
}

const modelKey = (configId: string, modelId: string): string => `${configId}\u0000${modelId}`

export const normalizeVisionModelAnalysisResult = (
  candidates: AiVisionModelCandidate[],
  output: VisionModelAnalysisOutput
): AiVisionModelAnalysisItem[] => {
  const candidateKeys = new Set(candidates.map((item) => modelKey(item.configId, item.modelId)))
  const seen = new Set<string>()
  return output.models.reduce<AiVisionModelAnalysisItem[]>((acc, model) => {
    const key = modelKey(model.configId, model.modelId)
    if (!candidateKeys.has(key) || seen.has(key)) return acc
    seen.add(key)
    acc.push({
      configId: model.configId,
      modelId: model.modelId,
      isVision: model.isVision,
      costTier: clampCostTier(model.costTier)
    })
    return acc
  }, [])
}
