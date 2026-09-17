export type NavigateSchemeMode = 'bare' | 'http' | 'https'

export type NavigatePlan = {
  mode: NavigateSchemeMode
  urls: string[]
}

export const BLANK_PAGE_ERROR = '页面已打开但内容为空，可能卡在站点安全验证。'

const HTTP_PROTOCOLS = new Set(['http:', 'https:'])

const assertHttpUrl = (parsed: URL): void => {
  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    throw new Error('内置浏览器只支持 http/https 地址')
  }
}

export const parseNavigatePlan = (rawUrl: string): NavigatePlan => {
  const value = String(rawUrl || '').trim()
  if (!value) throw new Error('请输入网址')
  const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(value)
  if (!hasScheme) {
    const httpsUrl = new URL(`https://${value}`)
    assertHttpUrl(httpsUrl)
    const httpUrl = new URL(httpsUrl.toString())
    httpUrl.protocol = 'http:'
    return { mode: 'bare', urls: [httpsUrl.toString(), httpUrl.toString()] }
  }
  const parsed = new URL(value)
  assertHttpUrl(parsed)
  return {
    mode: parsed.protocol === 'https:' ? 'https' : 'http',
    urls: [parsed.toString()]
  }
}

export const isInternalBrowserErrorUrl = (url: string): boolean => {
  const value = String(url || '')
  return value.startsWith('chrome-error://') || value.startsWith('chrome://')
}

export const parseNetErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  const matched = message.match(/ERR_[A-Z0-9_]+/u)
  return matched?.[0] || 'ERR_FAILED'
}

export const isHttpsFallbackWorthy = (codeOrDescription: string | number): boolean => {
  const text = String(codeOrDescription || '')
  if (!text) return false
  if (text.includes('ERR_ABORTED') || text === '-3') return false
  if (text.includes('ERR_NAME_NOT_RESOLVED') || text === '-105') return false
  if (text.includes('ERR_INTERNET_DISCONNECTED') || text === '-106') return false
  if (
    /ERR_CONNECTION_|ERR_SSL_|ERR_CERT_|ERR_EMPTY_RESPONSE|ERR_TIMED_OUT|ERR_ADDRESS_UNREACHABLE|ERR_SOCKS|ERR_PROXY|ERR_TUNNEL/u.test(
      text
    )
  ) {
    return true
  }
  const code = Number(text)
  return Number.isInteger(code) && code <= -100 && code >= -220 && code !== -105 && code !== -106
}

const isPlaceholderTitle = (url: string, title: string): boolean => {
  const value = title.trim()
  if (!value) return true
  try {
    const parsed = new URL(url)
    const hostPort = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname
    const hostPortPath = `${hostPort}${parsed.pathname}`
    const withoutProtocol = `${hostPort}${parsed.pathname}${parsed.search}`.replace(/\/$/u, '')
    return (
      value === parsed.hostname ||
      value === hostPort ||
      value === hostPortPath ||
      value === withoutProtocol ||
      value === parsed.href ||
      value === url
    )
  } catch {
    return false
  }
}

export const isNetErrorDocument = (input: {
  url: string
  title: string
  bodyText: string
}): boolean => {
  if (isInternalBrowserErrorUrl(input.url)) return true
  const text = `${input.title} ${input.bodyText}`
  return /无法访问此网站|无法访问此站点|ERR_[A-Z0-9_]{3,}|This site can.?t be reached/u.test(text)
}

export const isBlankDocument = (input: {
  url: string
  title: string
  bodyText: string
  controlCount: number
}): boolean => {
  if (isNetErrorDocument(input)) return false
  if (input.bodyText.trim().length > 0) return false
  if (input.controlCount > 0) return false
  return isPlaceholderTitle(input.url, input.title)
}

export const formatNavigateNetError = (input: {
  code: string
  httpsUrl?: string
  httpUrl?: string
  url: string
  mode: NavigateSchemeMode
  exhaustedFallback: boolean
}): string => {
  const code = input.code || 'ERR_FAILED'
  if (input.mode === 'bare' && input.exhaustedFallback && input.httpsUrl && input.httpUrl) {
    return `无法访问此站点（${code}）。${input.httpsUrl} 与 ${input.httpUrl} 均无法打开。`
  }
  if (input.mode === 'https') {
    return `无法访问此站点（${code}）。${input.url} 连接被服务器断开。可改试 http。`
  }
  return `无法访问此站点（${code}）。${input.url} 连接被服务器断开。`
}
