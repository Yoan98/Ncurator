export type NavigateSchemeMode = 'bare' | 'http' | 'https'

export type NavigatePlan = {
  mode: NavigateSchemeMode
  url: string
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
    return { mode: 'bare', url: httpsUrl.toString() }
  }
  const parsed = new URL(value)
  assertHttpUrl(parsed)
  return {
    mode: parsed.protocol === 'https:' ? 'https' : 'http',
    url: parsed.toString()
  }
}

export const isInternalBrowserErrorUrl = (url: string): boolean => {
  const value = String(url || '')
  return value.startsWith('chrome-error://') || value.startsWith('chrome://')
}

export const NET_ERROR_ABORTED_CODE = -3

const NET_ERROR_CODE_NAMES: Record<number, string> = {
  [NET_ERROR_ABORTED_CODE]: 'ERR_ABORTED',
  [-6]: 'ERR_FILE_NOT_FOUND',
  [-7]: 'ERR_TIMED_OUT',
  [-21]: 'ERR_NETWORK_CHANGED',
  [-100]: 'ERR_CONNECTION_CLOSED',
  [-101]: 'ERR_CONNECTION_RESET',
  [-102]: 'ERR_CONNECTION_REFUSED',
  [-103]: 'ERR_CONNECTION_ABORTED',
  [-104]: 'ERR_CONNECTION_FAILED',
  [-105]: 'ERR_NAME_NOT_RESOLVED',
  [-106]: 'ERR_INTERNET_DISCONNECTED',
  [-107]: 'ERR_SSL_PROTOCOL_ERROR',
  [-109]: 'ERR_ADDRESS_UNREACHABLE',
  [-118]: 'ERR_CONNECTION_TIMED_OUT',
  [-130]: 'ERR_PROXY_CONNECTION_FAILED',
  [-137]: 'ERR_NAME_RESOLUTION_FAILED',
  [-201]: 'ERR_CERT_DATE_INVALID',
  [-202]: 'ERR_CERT_AUTHORITY_INVALID',
  [-324]: 'ERR_EMPTY_RESPONSE'
}

export const parseNetErrorCode = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error || '')
  const matched = message.match(/ERR_[A-Z0-9_]+/u)
  if (matched?.[0]) return matched[0]
  const numeric = Number(message)
  if (Number.isInteger(numeric) && NET_ERROR_CODE_NAMES[numeric]) {
    return NET_ERROR_CODE_NAMES[numeric]
  }
  return 'ERR_FAILED'
}

export const isAbortedNetError = (code: number | string, description = ''): boolean => {
  if (code === NET_ERROR_ABORTED_CODE || code === '-3') return true
  return String(description || code).includes('ERR_ABORTED')
}

export const shouldPaintEmbeddedNetError = (input: {
  isMainFrame: boolean
  errorCode: number
  description?: string
}): boolean => {
  if (!input.isMainFrame) return false
  if (isAbortedNetError(input.errorCode, input.description)) return false
  return true
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

export const formatNavigateNetError = (input: { code: string; url: string }): string => {
  const code = input.code || 'ERR_FAILED'
  return `无法访问此站点（${code}）。${input.url} 连接被服务器断开。`
}
