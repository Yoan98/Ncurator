/** Normalize browser URLs for same-tab matching (markdown open / panel reuse). */
export const normalizeBrowserUrlKey = (raw: string): string => {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    url.hash = ''
    url.hostname = url.hostname.toLowerCase()
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.replace(/\/+$/, '')
    }
    return url.href
  } catch {
    return trimmed
  }
}

export const findBrowserTabByUrl = <T extends { url: string }>(
  tabs: readonly T[],
  targetUrl: string
): T | undefined => {
  const key = normalizeBrowserUrlKey(targetUrl)
  if (!key) return undefined
  return tabs.find((tab) => normalizeBrowserUrlKey(tab.url) === key)
}
