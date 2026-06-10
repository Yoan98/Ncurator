import type { JsonObject, JsonValue } from '../../../shared/types'

export type WebCrawlerLink = {
  href: string
  text?: string
}

export type WebCrawlerResult = {
  finalUrl: string
  title?: string
  markdown: string
  links: WebCrawlerLink[]
  publishedAt?: string
  raw: JsonObject
}

export type WebCrawlerService = {
  crawl: (input: { url: string; topic?: string }) => Promise<WebCrawlerResult>
  close: () => Promise<void>
}

export type WebCrawlerSidecarRequest = {
  id: string
  action: 'crawl'
  input: {
    url: string
    topic?: string
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
