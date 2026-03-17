const CHAT_COMPLETIONS_SUFFIX = /\/chat\/completions\/?$/

const trimTrailingSlash = (value: string): string => value.replace(/\/$/, '')

export const normalizeOpenAIBaseUrl = (input: string): string => {
  let normalized = String(input || '').trim()
  if (!normalized) return ''

  if (CHAT_COMPLETIONS_SUFFIX.test(normalized)) {
    normalized = normalized.replace(CHAT_COMPLETIONS_SUFFIX, '')
  }

  normalized = trimTrailingSlash(normalized)

  try {
    const url = new URL(normalized)
    const pathname = trimTrailingSlash(url.pathname)

    if (!pathname) {
      url.pathname = '/v1'
    }

    return trimTrailingSlash(url.toString())
  } catch {
    return normalized
  }
}
