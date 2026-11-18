import { LlmProviderError, type LlmBillingStatus, type LlmProviderDiagnostics } from './errors'

export type ProviderFailureCode =
  | 'upstream_timeout'
  | 'upstream_interrupted'
  | 'upstream_error'
  | 'upstream_quota_exhausted'
  | 'upstream_auth_failed'
  | 'upstream_rate_limited'
  | 'incomplete'
  | 'timeout'
  | 'client_disconnected'
  | 'not_sent'
  | 'model_concurrency_limited'
  | 'balance_insufficient'
  | 'payment_required'
  | 'settlement_in_progress'
  | 'settlement_pending'
  | 'unauthorized'
  | 'access_token_expired'
  | 'model_not_found'
  | 'context_limit'
  | 'image_not_supported'
  | 'invalid_request'
  | 'invalid_output'
  | 'content_filter'
  | 'output_truncated'
  | 'failed'
  | 'unavailable'
  | 'conflict'
  | 'not_found'

type FailureCopy = {
  title: string
  detail: string
  retryable: boolean
}

const FAILURES: Record<ProviderFailureCode, FailureCopy> = {
  upstream_timeout: {
    title: '上游模型超时',
    detail: '上游模型超时未返回。',
    retryable: true
  },
  upstream_interrupted: {
    title: '上游连接中断',
    detail: '上游连接中断，回答未完整接收。',
    retryable: true
  },
  upstream_error: {
    title: '上游模型服务出错',
    detail: '上游模型服务出错。',
    retryable: true
  },
  upstream_quota_exhausted: {
    title: '上游模型额度不足',
    detail: '上游模型账户额度不足，请稍后再试。',
    retryable: false
  },
  upstream_auth_failed: {
    title: '上游模型鉴权失败',
    detail: '上游模型鉴权失败，馆长服务暂时不可用。',
    retryable: false
  },
  upstream_rate_limited: {
    title: '上游模型限流',
    detail: '上游模型请求过多，请稍后再试。',
    retryable: true
  },
  incomplete: {
    title: '回答未完整接收',
    detail: '与馆长服务的连接意外中断，回答未完整接收。',
    retryable: true
  },
  timeout: {
    title: '模型响应超时',
    detail: '等待模型响应超过 5 分钟，已中断。',
    retryable: true
  },
  client_disconnected: {
    title: '请求已取消',
    detail: '连接已断开。',
    retryable: false
  },
  not_sent: {
    title: '请求未发送',
    detail: '本次请求未发送到上游。',
    retryable: false
  },
  model_concurrency_limited: {
    title: '模型请求排队中',
    detail: '馆长模型正在处理较多请求，请稍后再试。',
    retryable: true
  },
  balance_insufficient: {
    title: '余额不足',
    detail: '余额不足，请充值或缩短本次上下文。',
    retryable: false
  },
  payment_required: {
    title: '账户有待付费用',
    detail: '馆长账户有未付费用，请充值后再试。',
    retryable: false
  },
  settlement_in_progress: {
    title: '费用处理中',
    detail: '上一笔费用仍在处理，请稍后再试。',
    retryable: true
  },
  settlement_pending: {
    title: '费用处理中',
    detail: '本次费用仍在处理。',
    retryable: true
  },
  unauthorized: {
    title: '登录已失效',
    detail: '馆长账户登录已失效，请重新登录。',
    retryable: false
  },
  access_token_expired: {
    title: '登录已失效',
    detail: '馆长账户登录已失效，请重新登录。',
    retryable: false
  },
  model_not_found: {
    title: '模型不可用',
    detail: '该馆长模型已不可用，请重新选择。',
    retryable: false
  },
  context_limit: {
    title: '上下文超限',
    detail: '本次上下文超过模型限制，请缩短后重试。',
    retryable: false
  },
  image_not_supported: {
    title: '不支持图片输入',
    detail: '当前模型不支持图片输入。',
    retryable: false
  },
  invalid_request: {
    title: '请求参数无效',
    detail: '请求参数不符合要求，请调整后重试。',
    retryable: false
  },
  invalid_output: {
    title: '模型返回内容不完整',
    detail: '模型本次没有返回可用内容。',
    retryable: true
  },
  content_filter: {
    title: '内容安全拦截',
    detail: '本次请求被模型内容安全策略拦截，无法继续。',
    retryable: false
  },
  output_truncated: {
    title: '输出达到上限',
    detail: '本次回答达到输出上限，内容未完整接收。',
    retryable: false
  },
  failed: {
    title: '模型调用失败',
    detail: '馆长模型调用失败，请稍后再试。',
    retryable: true
  },
  unavailable: {
    title: '服务暂不可用',
    detail: '馆长模型服务暂不可用。',
    retryable: true
  },
  conflict: {
    title: '请求状态冲突',
    detail: '本次请求状态冲突，请重试。',
    retryable: true
  },
  not_found: {
    title: '请求不存在',
    detail: '未找到该模型或请求。',
    retryable: false
  }
}

const billingText = (billing?: LlmBillingStatus): string => {
  if (billing === 'waived') return '本次未计费。'
  if (billing === 'charged') return '本次已计费。'
  if (billing === 'unknown') return '计费状态待确认。'
  return ''
}

export const isProviderFailureCode = (value: unknown): value is ProviderFailureCode =>
  typeof value === 'string' && Object.hasOwn(FAILURES, value)

export const providerFailureTitle = (code?: string): string | undefined =>
  isProviderFailureCode(code) ? FAILURES[code].title : undefined

/** Normalize an HTTP failure from either the managed gateway or a custom provider. */
export const providerFailureCodeForHttp = (status?: number, message?: string): ProviderFailureCode | undefined => {
  if (status === 401) return 'upstream_auth_failed'
  if (status === 402) return 'upstream_quota_exhausted'
  if (status === 403) {
    return /quota|balance|insufficient|额度|余额/i.test(message ?? '')
      ? 'upstream_quota_exhausted' : 'upstream_auth_failed'
  }
  if (status === 429) return 'upstream_rate_limited'
  if (status !== undefined && status >= 500) return 'upstream_error'
  return undefined
}

export const providerFailureMessage = (code: ProviderFailureCode,
  billing?: LlmBillingStatus): string => FAILURES[code].detail + billingText(billing)

export const providerFailure = (code: ProviderFailureCode,
  options: {
    billing?: LlmBillingStatus
    status?: number
    cause?: unknown
    retryable?: boolean
    diagnostics?: LlmProviderDiagnostics
    /** Compact, user-readable facts appended to the stable detail. */
    messageSuffix?: string
  } = {}): LlmProviderError =>
  new LlmProviderError({
    providerCode: code,
    message: providerFailureMessage(code, options.billing) + (options.messageSuffix ?? ''),
    retryable: options.retryable ?? FAILURES[code].retryable,
    billing: options.billing,
    httpStatus: options.status,
    diagnostics: options.diagnostics,
    cause: options.cause
  })
