import type { LLMConfig, LlmModelListResponse, LlmRemoteModel } from '../../../shared/types'
import { normalizeOpenAIBaseUrl } from '../../../shared/llmBaseUrl'

type RemoteModelRow = {
  id?: string
  name?: string
  status?: string
  modalities?: {
    input_modalities?: string[]
    output_modalities?: string[]
  }
}

type RemoteModelListPayload = {
  data?: RemoteModelRow[]
}

const MODEL_LIST_TIMEOUT_MS = 20_000
const HIDDEN_MODEL_STATUSES = new Set(['shutdown', 'offline', 'deprecated', 'deleted'])

const buildModelListUrl = (baseUrl: string): string => {
  const normalized = normalizeOpenAIBaseUrl(baseUrl)
  if (!normalized) return ''
  return `${normalized.replace(/\/$/, '')}/models`
}

const toRemoteModels = (payload: RemoteModelListPayload): LlmRemoteModel[] =>
  (Array.isArray(payload.data) ? payload.data : []).reduce<LlmRemoteModel[]>((models, item) => {
    const id = String(item.id || item.name || '').trim()
    const status = String(item.status || '').trim()
    if (!id || HIDDEN_MODEL_STATUSES.has(status.toLowerCase())) return models
    models.push({
      id,
      label: id,
      status: status || undefined,
      inputModalities: Array.isArray(item.modalities?.input_modalities)
        ? item.modalities.input_modalities.filter(
            (value): value is string => typeof value === 'string'
          )
        : undefined,
      outputModalities: Array.isArray(item.modalities?.output_modalities)
        ? item.modalities.output_modalities.filter(
            (value): value is string => typeof value === 'string'
          )
        : undefined
    })
    return models
  }, [])

export const fetchLlmRemoteModels = async (config: LLMConfig): Promise<LlmModelListResponse> => {
  const url = buildModelListUrl(config.base_url)
  if (!url) return { success: false, items: [], error: '模型服务地址不能为空' }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MODEL_LIST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    if (!response.ok) {
      return {
        success: false,
        items: [],
        error: `获取模型列表失败：${response.status} ${response.statusText}`.trim()
      }
    }

    const payload = (await response.json()) as RemoteModelListPayload
    return { success: true, items: toRemoteModels(payload) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, items: [], error: message || '获取模型列表失败' }
  } finally {
    clearTimeout(timeout)
  }
}
