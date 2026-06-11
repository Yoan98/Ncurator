import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ManagedWebCrawlerService } from '../../../src/main/services/webCrawler/WebCrawlerService'

export const createWebCrawlerService = (): ManagedWebCrawlerService =>
  new ManagedWebCrawlerService({
    appRootPath: process.cwd(),
    isPackaged: false,
    sidecarEnv: {
      CRAWL4_AI_BASE_DIRECTORY: fs.mkdtempSync(
        path.join(os.tmpdir(), 'ncurator-web-crawler-test-')
      )
    },
    requestTimeoutMs: 180_000
  })
