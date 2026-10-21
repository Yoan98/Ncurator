import type { ServiceRoute } from './appPreferences'

export type ModelSource = 'modelscope' | 'huggingface-mirror' | 'huggingface'

export const MODEL_SOURCES: readonly ModelSource[] = [
  'modelscope',
  'huggingface-mirror',
  'huggingface'
]

export const MODEL_SOURCE_LABELS: Record<ModelSource, string> = {
  modelscope: 'ModelScope 镜像',
  'huggingface-mirror': 'Hugging Face mirror (hf-mirror)',
  huggingface: 'Hugging Face'
}

export const DEFAULT_MODEL_SOURCE: ModelSource = 'modelscope'

export const isModelSource = (value: unknown): value is ModelSource =>
  typeof value === 'string' && MODEL_SOURCES.includes(value as ModelSource)

export const defaultModelSource = (route: ServiceRoute): ModelSource =>
  route === 'international' ? 'huggingface' : 'modelscope'
