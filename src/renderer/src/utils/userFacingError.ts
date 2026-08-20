const INTERNAL_ERROR_PATTERNS = [
  /langgraph/iu,
  /recursionlimit/iu,
  /graph_recursion_limit/iu,
  /structured_output_/iu,
  /prompt_json_/iu,
  /caller=/iu,
  /schema=/iu,
  /cannot read properties of/iu,
  /\b(?:typeerror|referenceerror|syntaxerror)\b/iu,
  /node_modules/iu,
  /\/src\/(?:main|renderer)\//iu,
  /\/users\/[^\s]+\/[^\s]+\.(?:ts|tsx|js|mjs)/iu,
  /\n\s*at\s+/u
]

const VC_RUNTIME_ERROR_PATTERNS = [
  /dynamic link library/iu,
  /dll initialization/iu,
  /\bdll\b/iu,
  /\b1114\b/iu
]

export const normalizeUserFacingError = (value: unknown, fallback = '操作失败'): string => {
  const message = String(value || '').trim()
  if (!message) return fallback
  const lower = message.toLowerCase()
  if (lower === 'cancelled' || lower === 'canceled' || lower === 'run cancelled') return '已取消'
  if (lower === 'run not active' || lower === 'run not found') return '当前运行已结束'
  if (lower === 'session deleted') return '当前会话已删除'
  if (VC_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(message))) {
    return '向量模型运行库加载失败，请安装 Microsoft Visual C++ 2015-2022 运行库后重试'
  }
  return INTERNAL_ERROR_PATTERNS.some((pattern) => pattern.test(message)) ? fallback : message
}
