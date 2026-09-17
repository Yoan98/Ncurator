import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { rm } from 'node:fs/promises'
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

const waitForIsolatedHostCdpUrl = async (
  userDataPath: string,
  timeoutMs = 20_000
): Promise<string> => {
  const deadline = Date.now() + timeoutMs
  const activePortPath = path.join(userDataPath, 'DevToolsActivePort')
  let latestError: unknown
  while (Date.now() < deadline) {
    try {
      const [portText = '', browserPath = ''] = fs.readFileSync(activePortPath, 'utf8').split(/\r?\n/u)
      const port = Number.parseInt(portText.trim(), 10)
      const normalizedBrowserPath = browserPath.trim()
      if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
        throw new Error('DevToolsActivePort contains an invalid port')
      }
      if (!normalizedBrowserPath.startsWith('/devtools/browser/')) {
        throw new Error('DevToolsActivePort contains an invalid browser path')
      }
      const response = await fetch(`http://127.0.0.1:${String(port)}/json/version`, {
        signal: AbortSignal.timeout(1_000)
      })
      if (!response.ok) throw new Error(`CDP version endpoint returned ${response.status}`)
      const payload = (await response.json()) as { webSocketDebuggerUrl?: unknown }
      const parsed = new URL(String(payload.webSocketDebuggerUrl || '').trim())
      if (
        parsed.protocol !== 'ws:' ||
        Number(parsed.port) !== port ||
        parsed.pathname !== normalizedBrowserPath
      ) {
        throw new Error('CDP version endpoint returned an unexpected WebSocket URL')
      }
      return parsed.toString()
    } catch (error) {
      latestError = error
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }
  const reason = latestError instanceof Error ? latestError.message : String(latestError || '')
  throw new Error(`embedded_browser_cdp_unavailable: ${reason || 'endpoint not ready'}`)
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
  let cdpUrl: string
  try {
    cdpUrl = await waitForIsolatedHostCdpUrl(cdpUserDataPath)
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
