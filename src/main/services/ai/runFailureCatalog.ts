import type { AiRunFailureCode, AiRunFailureSource } from '../../../shared/types'

export type AiRunFailureCatalogEntry = {
  source: AiRunFailureSource | 'user'
  title: string
}

export const AI_RUN_FAILURE_CATALOG: Record<AiRunFailureCode, AiRunFailureCatalogEntry> = {
  user_cancelled: {
    source: 'user',
    title: '已取消'
  },
  process_interrupted: {
    source: 'internal',
    title: '任务已中断，可继续对话推进'
  },
  llm_request_failed: {
    source: 'provider',
    title: '模型请求失败'
  },
  output_truncated: {
    source: 'internal',
    title: '模型输出达到长度限制，可发送「继续」接着完成'
  },
  input_too_long: {
    source: 'internal',
    title: '当前输入超过模型上下文限制，请缩短后重试'
  },
  runtime_limit: {
    source: 'internal',
    title: '已达到运行上限，可继续对话推进'
  },
  internal_error: {
    source: 'internal',
    title: '运行遇到内部错误'
  },
  unexpected_error: {
    source: 'internal',
    title: '运行失败，请重试'
  }
}

export type AiRunFailurePresentation = {
  title: string
  message: string
  rawMessage?: string
  source: AiRunFailureSource | 'user'
}

export const resolveAiRunFailurePresentation = (
  code: AiRunFailureCode,
  rawMessage?: string
): AiRunFailurePresentation => {
  const entry = AI_RUN_FAILURE_CATALOG[code]
  const normalizedRaw = rawMessage?.trim() ? rawMessage.trim() : undefined
  return {
    title: entry.title,
    message: entry.title,
    rawMessage: normalizedRaw,
    source: entry.source
  }
}
