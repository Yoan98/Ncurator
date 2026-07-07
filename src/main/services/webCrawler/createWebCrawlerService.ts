import {
  ManagedWebCrawlerService,
  type WebCrawlerServiceOptions
} from './WebCrawlerService'
import type { WebCrawlerResult, WebCrawlerService, WebSearchResult } from './types'

export class UnavailableWebCrawlerService implements WebCrawlerService {
  public readonly reason: string

  public constructor(reason: string) {
    this.reason = reason
  }

  public async crawl(): Promise<WebCrawlerResult> {
    throw new Error(`网页抓取服务不可用：${this.reason}`)
  }

  public async search(): Promise<WebSearchResult> {
    throw new Error(`网页搜索服务不可用：${this.reason}`)
  }

  public async close(): Promise<void> {
    return
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createWebCrawlerService = (
  options: WebCrawlerServiceOptions = {}
): WebCrawlerService => {
  try {
    return new ManagedWebCrawlerService(options)
  } catch (error) {
    const message = getErrorMessage(error)
    console.warn(`[WEB-CRAWLER] Web crawler service is unavailable: ${message}`)
    return new UnavailableWebCrawlerService(message)
  }
}
