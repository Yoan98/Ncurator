import { inspect } from 'node:util'
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

const describeRequestException = (error: unknown): string =>
  inspect(error, {
    depth: null,
    colors: false,
    customInspect: false,
    getters: false,
    maxArrayLength: null,
    maxStringLength: null
  })

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
  const fail = (details: string): LlmModelListResponse => {
    const error = `GET ${url}\n\n${details}`
    return {
      success: false,
      items: [],
      error: config.api_key ? error.split(config.api_key).join('[REDACTED]') : error
    }
  }
  let response: Response | undefined
  let body: string | undefined

  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.api_key}`,
        Accept: 'application/json'
      },
      signal: controller.signal
    })
    body = await response.text()
    const status = `HTTP ${response.status} ${response.statusText}`.trim()
    if (!response.ok) return fail([status, body].filter(Boolean).join('\n\n'))

    let payload: RemoteModelListPayload | null
    try {
      payload = JSON.parse(body) as RemoteModelListPayload | null
    } catch (error) {
      return fail(`${status}\n响应不是有效的 JSON\n\n${body}\n\n${describeRequestException(error)}`)
    }
    if (!payload || !Array.isArray(payload.data)) {
      return fail(`${status}\n服务返回的数据格式不符合预期：缺少 data 数组\n\n${body}`)
    }
    return { success: true, items: toRemoteModels(payload) }
  } catch (error) {
    return fail(
      [
        response ? `HTTP ${response.status} ${response.statusText}`.trim() : '未收到 HTTP 响应',
        controller.signal.aborted ? '请求超时（20 秒）' : '',
        describeRequestException(error),
        body
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  } finally {
    clearTimeout(timeout)
  }
}
