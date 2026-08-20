const VC_RUNTIME_ERROR_PATTERNS: readonly RegExp[] = [
  /dynamic link library/iu,
  /dll initialization/iu,
  /\bdll\b/iu,
  /\b1114\b/iu
]

export const VC_RUNTIME_ERROR_MESSAGE =
  '向量模型运行库加载失败，请安装 Microsoft Visual C++ 2015-2022 运行库后重试。'

export const EMBEDDING_INITIALIZATION_ERROR_MESSAGE =
  '向量模型初始化失败，请检查模型是否完整，或删除后重新下载模型。'

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error ?? '')

export const isVcRuntimeError = (error: unknown): boolean =>
  VC_RUNTIME_ERROR_PATTERNS.some((pattern) => pattern.test(toErrorMessage(error)))

export const toEmbeddingInitializationMessage = (error: unknown): string =>
  isVcRuntimeError(error) ? VC_RUNTIME_ERROR_MESSAGE : EMBEDDING_INITIALIZATION_ERROR_MESSAGE
