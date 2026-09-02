import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio'
import type { WebSearchFetchOutput } from './outputTypes'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const HTTP_PAGE_FETCH_TIMEOUT_MS = 20_000

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
  const loader = new CheerioWebBaseLoader(url, { timeout: HTTP_PAGE_FETCH_TIMEOUT_MS })
  const $ = await loader.scrape()
  const title = $('title').first().text().trim() || undefined
  const markdown = normalizePageText($('body').text() || $.root().text())
  if (!markdown) {
    throw new Error('网页正文为空')
  }
  return {
    requestedUrl: url,
    finalUrl: url,
    ...(title ? { title } : {}),
    markdown,
    links: {
      internal: [],
      external: []
    }
  }
}
