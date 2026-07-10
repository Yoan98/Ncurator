import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { rm } from 'node:fs/promises'
import { ManagedWebCrawlerService } from '../../../src/main/services/webCrawler/WebCrawlerService'

export const createWebCrawlerService = (): ManagedWebCrawlerService => {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-web-crawler-test-'))
  const service = new ManagedWebCrawlerService({
    appRootPath: process.cwd(),
    isPackaged: false,
    sidecarEnv: {
      CRAWL4_AI_BASE_DIRECTORY: baseDirectory
    },
    requestTimeoutMs: 180_000
  })
  const closeService = service.close.bind(service)
  service.close = async (): Promise<void> => {
    try {
      await closeService()
    } finally {
      await rm(baseDirectory, { recursive: true, force: true })
    }
  }
  return service
}
