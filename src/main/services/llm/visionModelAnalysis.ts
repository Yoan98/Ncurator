import { z } from 'zod/v4'

export const visionModelAnalysisSchema = z.object({
  models: z.array(z.string())
})

export type VisionModelAnalysisOutput = z.infer<typeof visionModelAnalysisSchema>

export const normalizeVisionModelAnalysisResult = (
  modelNames: string[],
  output: VisionModelAnalysisOutput
): string[] => {
  const candidates = new Set(modelNames.map((name) => String(name).trim()).filter(Boolean))
  const seen = new Set<string>()
  return output.models.reduce<string[]>((acc, rawName) => {
    const modelName = String(rawName || '').trim()
    if (!modelName || !candidates.has(modelName) || seen.has(modelName)) return acc
    seen.add(modelName)
    acc.push(modelName)
    return acc
  }, [])
}
