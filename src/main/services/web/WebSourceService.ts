import crypto from 'node:crypto'
import { load } from 'cheerio'
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
    workspaceId: string
    url: string
    normalizedUrl: string
    title?: string
    documentId?: string
    includeSelectors?: string[]
    excludeSelectors?: string[]
    indexStatus?: WebSourceRecord['index_status']
    fetchedAt?: number
    lastCheckedAt?: number
    lastCrawledAt?: number
    lastIndexedAt?: number
    etag?: string
    lastModified?: string
    contentLength?: number
    contentHash?: string
    lastError?: string
    now?: number
  }): WebSourceRecord {
    const now = params.now ?? Date.now()
    return {
      id: uuidv4(),
      workspace_id: params.workspaceId,
      identity_kind: 'normalized_url',
      normalized_url: params.normalizedUrl,
      url: params.url,
      title: params.title,
      document_id: params.documentId,
      index_status: params.indexStatus || 'needs_index',
      include_selectors: normalizeSelectors(params.includeSelectors),
      exclude_selectors: normalizeSelectors(params.excludeSelectors),
      fetched_at: params.fetchedAt,
      last_checked_at: params.lastCheckedAt,
      last_crawled_at: params.lastCrawledAt,
      last_indexed_at: params.lastIndexedAt,
      etag: params.etag,
      last_modified: params.lastModified,
      content_length: params.contentLength,
      content_hash: params.contentHash,
      last_error: params.lastError,
      created_at: now,
      updated_at: now
    }
  }

  public async inspectUrl(payload: {
    url: string
    includeSelectors?: string[]
    excludeSelectors?: string[]
  }): Promise<{
    title?: string
    text: string
    contentHash: string
    contentLength: number
    etag?: string
    lastModified?: string
  }> {
    const response = await fetch(payload.url)
    if (!response.ok) {
      throw new Error(`网页请求失败：${response.status}`)
    }
    const html = await response.text()
    const $ = load(html)
    const title = $('title').first().text().trim() || undefined
    const includeSelector =
      payload.includeSelectors && payload.includeSelectors.length > 0
        ? payload.includeSelectors.join(',')
        : 'body'
    const $root = $(includeSelector)
    $root.find('script,style,noscript,nav,header,footer,aside,form,svg,canvas,iframe').remove()
    for (const selector of payload.excludeSelectors || []) {
      if (!selector.trim()) continue
      $root.find(selector).remove()
    }
    const text = $root
      .text()
      .replace(/\u00a0/g, ' ')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
      .join('\n')
    if (!text) {
      throw new Error('网页正文为空')
    }
    return {
      title,
      text,
      contentHash: crypto.createHash('sha1').update(text).digest('hex'),
      contentLength: Number(response.headers.get('content-length') || '') || html.length,
      etag: response.headers.get('etag') || undefined,
      lastModified: response.headers.get('last-modified') || undefined
    }
  }
}
