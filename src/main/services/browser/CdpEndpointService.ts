import { readFile } from 'node:fs/promises'
import path from 'node:path'

export const DEVTOOLS_ACTIVE_PORT_FILENAME = 'DevToolsActivePort'

export type CdpEndpoint = {
  port: number
  httpOrigin: string
  browserWebSocketUrl: string
}

type CdpEndpointServiceOptions = {
  userDataPath: string
  timeoutMs?: number
  pollIntervalMs?: number
  fetchImpl?: typeof fetch
}

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

export const parseDevToolsActivePort = (content: string): { port: number; browserPath: string } => {
  const [portText = '', browserPath = ''] = content.split(/\r?\n/u)
  const port = Number.parseInt(portText.trim(), 10)
  const normalizedBrowserPath = browserPath.trim()
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error('DevToolsActivePort contains an invalid port')
  }
  if (!normalizedBrowserPath.startsWith('/devtools/browser/')) {
    throw new Error('DevToolsActivePort contains an invalid browser path')
  }
  return { port, browserPath: normalizedBrowserPath }
}

const readBrowserWebSocketUrl = async (
  httpOrigin: string,
  expectedPort: number,
  expectedBrowserPath: string,
  fetchImpl: typeof fetch
): Promise<string> => {
  const response = await fetchImpl(`${httpOrigin}/json/version`, {
    signal: AbortSignal.timeout(1_000)
  })
  if (!response.ok) throw new Error(`CDP version endpoint returned ${response.status}`)
  const payload = (await response.json()) as { webSocketDebuggerUrl?: unknown }
  const rawUrl = String(payload.webSocketDebuggerUrl || '').trim()
  const parsed = new URL(rawUrl)
  if (
    parsed.protocol !== 'ws:' ||
    !LOOPBACK_HOSTNAMES.has(parsed.hostname) ||
    Number(parsed.port) !== expectedPort ||
    parsed.pathname !== expectedBrowserPath
  ) {
    throw new Error('CDP version endpoint returned an unexpected WebSocket URL')
  }
  return parsed.toString()
}

export class CdpEndpointService {
  private readonly activePortPath: string
  private readonly timeoutMs: number
  private readonly pollIntervalMs: number
  private readonly fetchImpl: typeof fetch
  private endpointPromise: Promise<CdpEndpoint> | null = null

  public constructor(options: CdpEndpointServiceOptions) {
    this.activePortPath = path.join(options.userDataPath, DEVTOOLS_ACTIVE_PORT_FILENAME)
    this.timeoutMs = options.timeoutMs || 10_000
    this.pollIntervalMs = options.pollIntervalMs || 100
    this.fetchImpl = options.fetchImpl || fetch
  }

  public getEndpoint(): Promise<CdpEndpoint> {
    this.endpointPromise ||= this.resolveEndpoint().catch((error) => {
      this.endpointPromise = null
      throw error
    })
    return this.endpointPromise
  }

  private async resolveEndpoint(): Promise<CdpEndpoint> {
    const deadline = Date.now() + this.timeoutMs
    let latestError: unknown
    while (Date.now() < deadline) {
      try {
        const activePort = parseDevToolsActivePort(await readFile(this.activePortPath, 'utf8'))
        const httpOrigin = `http://127.0.0.1:${String(activePort.port)}`
        const browserWebSocketUrl = await readBrowserWebSocketUrl(
          httpOrigin,
          activePort.port,
          activePort.browserPath,
          this.fetchImpl
        )
        return {
          port: activePort.port,
          httpOrigin,
          browserWebSocketUrl
        }
      } catch (error) {
        latestError = error
        await new Promise<void>((resolve) => setTimeout(resolve, this.pollIntervalMs))
      }
    }
    const reason = latestError instanceof Error ? latestError.message : String(latestError || '')
    throw new Error(`embedded_browser_cdp_unavailable: ${reason || 'endpoint not ready'}`)
  }
}
