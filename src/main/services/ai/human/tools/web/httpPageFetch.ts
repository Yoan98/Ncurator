import * as cheerio from 'cheerio'
import type { WebSearchFetchOutput } from './outputTypes'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const HTTP_PAGE_FETCH_TIMEOUT_MS = 20_000

export class HttpPageFetchError extends Error {
  public readonly requestedUrl: string
  public readonly finalUrl: string
  public readonly statusCode: number

  public constructor(input: {
    message: string
    requestedUrl: string
    finalUrl: string
    statusCode: number
  }) {
    super(input.message)
    this.name = 'HttpPageFetchError'
    this.requestedUrl = input.requestedUrl
    this.finalUrl = input.finalUrl
    this.statusCode = input.statusCode
  }
}

export const isHttpPageFetchError = (error: unknown): error is HttpPageFetchError =>
  error instanceof HttpPageFetchError

export const isLoopbackHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      LOOPBACK_HOSTNAMES.has(parsed.hostname)
    )
  } catch {
    return false
  }
}

export const shouldBypassCrawlerForLoopbackFetch = (): boolean =>
  process.env.NCURATOR_WEB_SEARCH_LOOPBACK_FETCH === '1'

const normalizePageText = (input: string): string =>
  input
    .replace(/\u00a0/g, ' ')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
    .join('\n')

export const fetchHttpPage = async (url: string): Promise<WebSearchFetchOutput> => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(HTTP_PAGE_FETCH_TIMEOUT_MS)
  })
  const finalUrl = response.url || url
  if (!response.ok) {
    throw new HttpPageFetchError({
      message: `网页请求失败：${response.status}`,
      requestedUrl: url,
      finalUrl,
      statusCode: response.status
    })
  }

  const html = await response.text()
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim() || undefined
  const markdown = normalizePageText($('body').text() || $.root().text())
  if (!markdown) {
    throw new Error('网页正文为空')
  }
  return {
    requestedUrl: url,
    finalUrl,
    ...(title ? { title } : {}),
    markdown,
    links: {
      internal: [],
      external: []
    }
  }
}
