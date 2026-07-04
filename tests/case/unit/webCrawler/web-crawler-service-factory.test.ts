import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createWebCrawlerService,
  UnavailableWebCrawlerService
} from '../../../../src/main/services/webCrawler/createWebCrawlerService'

describe('web crawler service factory', () => {
  it('falls back to an unavailable service when the development sidecar is missing', async () => {
    const appRootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-missing-sidecar-'))
    const service = createWebCrawlerService({
      appRootPath,
      isPackaged: false
    })

    expect(service).toBeInstanceOf(UnavailableWebCrawlerService)
    await expect(service.crawl({ url: 'https://example.com' })).rejects.toThrow(
      '网页抓取服务不可用'
    )
    await expect(service.close()).resolves.toBeUndefined()
  })
})
