export type ModelSource = 'modelscope' | 'huggingface-mirror'

export const MODEL_SOURCES: readonly ModelSource[] = ['modelscope', 'huggingface-mirror']

export const MODEL_SOURCE_LABELS: Record<ModelSource, string> = {
  modelscope: 'ModelScope 镜像',
  'huggingface-mirror': 'HuggingFace 镜像 (hf-mirror)'
}

export const DEFAULT_MODEL_SOURCE: ModelSource = 'modelscope'

export const isModelSource = (value: unknown): value is ModelSource =>
  typeof value === 'string' && MODEL_SOURCES.includes(value as ModelSource)
