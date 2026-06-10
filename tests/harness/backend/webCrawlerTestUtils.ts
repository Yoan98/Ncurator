import path from 'node:path'
import { ManagedWebCrawlerService } from '../../../src/main/services/webCrawler/WebCrawlerService'

export const createMockWebCrawlerService = (): ManagedWebCrawlerService =>
  new ManagedWebCrawlerService({
    sidecarCommand: {
      executablePath: process.execPath,
      args: [path.join(process.cwd(), 'tests', 'harness', 'backend', 'mockWebCrawlerSidecar.mjs')]
    },
    requestTimeoutMs: 15_000
  })
