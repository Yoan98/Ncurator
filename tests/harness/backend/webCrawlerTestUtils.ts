import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { rm } from 'node:fs/promises'
import { CdpEndpointService } from '../../../src/main/services/browser/CdpEndpointService'
import { ManagedWebCrawlerService } from '../../../src/main/services/webCrawler/WebCrawlerService'

const electronExecutablePath = createRequire(import.meta.url)('electron') as string
const playwrightNodeExecutablePath = path.resolve(
  String(process.env.NCURATOR_TEST_PLAYWRIGHT_NODEJS_PATH || electronExecutablePath)
)

const stopProcess = async (child: ChildProcess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 3_000))
  ])
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await exited
  }
}

export const createWebCrawlerService = async (): Promise<ManagedWebCrawlerService> => {
  const baseDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-web-crawler-test-'))
  const cdpUserDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ncurator-cdp-host-test-'))
  const hostScriptPath = path.resolve(
    process.cwd(),
    'tests',
    'harness',
    'backend',
    'electronCdpHost.mjs'
  )
  const cdpHost = spawn(electronExecutablePath, [hostScriptPath], {
    env: {
      ...process.env,
      NCURATOR_TEST_CDP_USER_DATA_PATH: cdpUserDataPath
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  let cdpHostStderr = ''
  cdpHost.stderr?.on('data', (chunk) => {
    cdpHostStderr = `${cdpHostStderr}${String(chunk)}`.slice(-8_000)
  })
  const cdpEndpointService = new CdpEndpointService({
    userDataPath: cdpUserDataPath,
    timeoutMs: 20_000
  })
  let cdpUrl: string
  try {
    cdpUrl = (await cdpEndpointService.getEndpoint()).browserWebSocketUrl
  } catch (error) {
    await stopProcess(cdpHost)
    await Promise.all([
      rm(baseDirectory, { recursive: true, force: true }),
      rm(cdpUserDataPath, { recursive: true, force: true })
    ])
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${reason}${cdpHostStderr.trim() ? `: ${cdpHostStderr.trim()}` : ''}`)
  }
  const service = new ManagedWebCrawlerService({
    appRootPath: process.cwd(),
    isPackaged: false,
    playwrightNodeExecutablePath,
    sidecarEnv: {
      CRAWL4_AI_BASE_DIRECTORY: baseDirectory
    },
    resolveCdpConnection: async () => ({
      browserWebSocketUrl: cdpUrl,
      contextMarkerUrl: 'about:blank#ncurator-web-crawler-test'
    }),
    requestTimeoutMs: 180_000
  })
  const closeService = service.close.bind(service)
  service.close = async (): Promise<void> => {
    try {
      await closeService()
    } finally {
      await stopProcess(cdpHost)
      await Promise.all([
        rm(baseDirectory, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100
        }),
        rm(cdpUserDataPath, {
          recursive: true,
          force: true,
          maxRetries: 20,
          retryDelay: 100
        })
      ])
    }
  }
  return service
}
