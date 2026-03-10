import { v4 as uuidv4 } from 'uuid'
import type { WebSourceRecord } from '../../types/store'

const normalizeSelectors = (value?: string[]): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const next = Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
  return next.length > 0 ? next : undefined
}

export class WebSourceService {
  public normalizeUrl(rawUrl: string): { url: string; normalizedUrl: string } {
    const parsed = new URL(String(rawUrl || '').trim())
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error('仅支持 http/https URL')
    }

    parsed.hash = ''
    parsed.hostname = parsed.hostname.toLowerCase()

    const isDefaultHttpPort = parsed.protocol === 'http:' && parsed.port === '80'
    const isDefaultHttpsPort = parsed.protocol === 'https:' && parsed.port === '443'
    if (isDefaultHttpPort || isDefaultHttpsPort) {
      parsed.port = ''
    }

    const nextPathname = parsed.pathname.replace(/\/{2,}/g, '/')
    parsed.pathname =
      nextPathname.length > 1 ? nextPathname.replace(/\/+$/g, '') || '/' : nextPathname || '/'

    const sortedParams = Array.from(parsed.searchParams.entries()).sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) return leftValue.localeCompare(rightValue)
      return leftKey.localeCompare(rightKey)
    })
    parsed.search = ''
    for (const [key, value] of sortedParams) {
      parsed.searchParams.append(key, value)
    }

    return {
      url: parsed.toString(),
      normalizedUrl: parsed.toString()
    }
  }

  public createWebSource(params: {
    url: string
    normalizedUrl: string
    title?: string
    documentId?: string
    includeSelectors?: string[]
    excludeSelectors?: string[]
    importStatus: WebSourceRecord['import_status']
    fetchedAt?: number
    lastError?: string
    now?: number
  }): WebSourceRecord {
    const now = params.now ?? Date.now()
    return {
      id: uuidv4(),
      identity_kind: 'normalized_url',
      normalized_url: params.normalizedUrl,
      url: params.url,
      title: params.title,
      document_id: params.documentId,
      import_status: params.importStatus,
      include_selectors: normalizeSelectors(params.includeSelectors),
      exclude_selectors: normalizeSelectors(params.excludeSelectors),
      fetched_at: params.fetchedAt,
      last_error: params.lastError,
      created_at: now,
      updated_at: now
    }
  }
}
