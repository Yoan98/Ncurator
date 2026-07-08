import type { JsonObject, JsonValue } from '../../../shared/types'

export type WebCrawlerLink = {
  href: string
  text?: string
  title?: string
  baseDomain?: string
  headData?: JsonObject
  headExtractionStatus?: string
  headExtractionError?: string
  intrinsicScore?: number
  contextualScore?: number
  totalScore?: number
}

export type WebCrawlerLinks = {
  internal: WebCrawlerLink[]
  external: WebCrawlerLink[]
}

export type WebCrawlerResult = {
  requestedUrl: string
  finalUrl: string
  title?: string
  markdown: string
  links: WebCrawlerLinks
  publishedAt?: string
  raw: JsonObject
}

export type WebSearchResultItem = {
  rank: number
  title: string
  url: string
  snippet?: string
}

export type WebSearchResult = {
  query: string
  results: WebSearchResultItem[]
  raw: JsonObject
}

export type WebCrawlerService = {
  crawl: (input: { url: string; topic: string }) => Promise<WebCrawlerResult>
  search: (input: { query: string }) => Promise<WebSearchResult>
  close: () => Promise<void>
}

export type WebCrawlerSidecarRequest =
  | {
      id: string
      action: 'crawl'
      input: {
        url: string
        topic: string
      }
    }
  | {
      id: string
      action: 'search'
      input: {
        query: string
      }
    }

export type WebCrawlerSidecarSuccessResponse = {
  id: string
  ok: true
  data: JsonObject
}

export type WebCrawlerSidecarErrorResponse = {
  id: string
  ok: false
  error: string
  data?: JsonValue
}

export type WebCrawlerSidecarResponse =
  | WebCrawlerSidecarSuccessResponse
  | WebCrawlerSidecarErrorResponse
