import { randomUUID } from 'node:crypto'
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { JsonObject, JsonValue } from '../../../shared/types'
import type {
  WebCrawlerLink,
  WebCrawlerLinks,
  WebCrawlerResult,
  WebCrawlerService as WebCrawlerServiceContract,
  WebCrawlerSidecarRequest,
  WebCrawlerSidecarResponse,
  WebSearchResult,
  WebSearchResultItem
} from './types'
import type { WebCrawlerCdpConnection } from './ElectronWebCrawlerBrowserHost'

type SidecarCommand = {
  executablePath: string
  args: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
}

type PendingRequest = {
  resolve: (value: JsonObject) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export type WebCrawlerServiceOptions = {
  sidecarCommand?: SidecarCommand
  sidecarEnv?: NodeJS.ProcessEnv
  playwrightNodeExecutablePath?: string
  resolveCdpConnection?: () => Promise<WebCrawlerCdpConnection>
  appRootPath?: string
  isPackaged?: boolean
  resourcesPath?: string
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const PACKAGED_SIDECAR_DIR = 'web_crawler_sidecar'
const PACKAGED_SIDECAR_BIN_DIR = 'bin'
const PYTHON_SIDECAR_DEBUG_ENV = 'NCURATOR_WEB_CRAWLER_USE_PYTHON_SIDECAR'
const SIDECAR_CDP_URL_ENV = 'NCURATOR_WEB_CRAWLER_CDP_URL'
const SIDECAR_CDP_CONTEXT_MARKER_ENV = 'NCURATOR_WEB_CRAWLER_CDP_CONTEXT_MARKER_URL'
const PLAYWRIGHT_NODEJS_PATH_ENV = 'PLAYWRIGHT_NODEJS_PATH'
const ELECTRON_RUN_AS_NODE_ENV = 'ELECTRON_RUN_AS_NODE'
const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
const DEV_SIDECAR_SCRIPT_PATH = path.join(
  'resources',
  'web_crawler_sidecar',
  'web_crawler_sidecar.py'
)

const isObjectRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const killSidecarTree = (child: ChildProcessWithoutNullStreams): void => {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true
      })
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

const readString = (value: JsonValue | undefined): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined

const readObjectString = (obj: JsonObject | undefined, key: string): string | undefined =>
  obj ? readString(obj[key]) : undefined

const readNumber = (value: JsonValue | undefined): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

const readObjectNumber = (obj: JsonObject | undefined, key: string): number | undefined =>
  obj ? readNumber(obj[key]) : undefined

const readMarkdownText = (value: JsonValue | undefined): string | undefined => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim()
  }
  if (!isObjectRecord(value)) return undefined

  return (
    readObjectString(value, 'fit_markdown')
    || readObjectString(value, 'fitMarkdown')
    || readObjectString(value, 'raw_markdown')
    || readObjectString(value, 'rawMarkdown')
    || readObjectString(value, 'markdown')
    || readObjectString(value, 'content')
  )
}

const readPublishedAtFromMetadata = (value: JsonValue | undefined): string | undefined => {
  if (!isObjectRecord(value)) return undefined
  return (
    readObjectString(value, 'published_time')
    || readObjectString(value, 'publishedTime')
    || readObjectString(value, 'datePublished')
    || readObjectString(value, 'publishdate')
    || readObjectString(value, 'pubdate')
    || readObjectString(value, 'article:published_time')
    || readObjectString(value, 'modified_time')
    || readObjectString(value, 'modifiedTime')
  )
}

const readPublishedAt = (obj: JsonObject): string | undefined => {
  const metadata = isObjectRecord(obj.metadata) ? obj.metadata : undefined
  const rawJsonLd = obj.json_ld
  const jsonLdItems = Array.isArray(rawJsonLd)
    ? rawJsonLd.filter(isObjectRecord)
    : isObjectRecord(rawJsonLd)
      ? [rawJsonLd]
      : []

  return (
    readObjectString(obj, 'published_at')
    || readObjectString(obj, 'publishedAt')
    || readPublishedAtFromMetadata(metadata)
    || jsonLdItems.map(readPublishedAtFromMetadata).find(Boolean)
  )
}

const readStatusCode = (obj: JsonObject | undefined): number | undefined =>
  readObjectNumber(obj, 'status_code')
  || readObjectNumber(obj, 'statusCode')
  || readObjectNumber(obj, 'http_status')
  || readObjectNumber(obj, 'httpStatus')
  || readObjectNumber(obj, 'status')

const readErrorMessage = (obj: JsonObject | undefined): string | undefined =>
  readObjectString(obj, 'error')
  || readObjectString(obj, 'error_message')
  || readObjectString(obj, 'errorMessage')
  || readObjectString(obj, 'message')

class WebCrawlerSidecarError extends Error {
  public readonly requestedUrl?: string
  public readonly finalUrl?: string
  public readonly statusCode?: number
  public readonly raw?: JsonValue

  public constructor(input: {
    message: string
    requestedUrl?: string
    finalUrl?: string
    statusCode?: number
    raw?: JsonValue
  }) {
    super(input.message)
    this.name = 'WebCrawlerSidecarError'
    this.requestedUrl = input.requestedUrl
    this.finalUrl = input.finalUrl
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}

const readFinalUrl = (obj: JsonObject | undefined): string | undefined =>
  readObjectString(obj, 'final_url')
  || readObjectString(obj, 'finalUrl')
  || readObjectString(obj, 'redirected_url')
  || readObjectString(obj, 'redirectedUrl')
  || readObjectString(obj, 'url')

const readRequestedUrl = (obj: JsonObject | undefined): string | undefined =>
  readObjectString(obj, 'requested_url')
  || readObjectString(obj, 'requestedUrl')
  || readObjectString(obj, 'url')

const normalizeLinkItem = (value: JsonValue | undefined): WebCrawlerLink | undefined => {
  if (!isObjectRecord(value)) return undefined
  const href = readObjectString(value, 'href')
  if (!href) return undefined
  const text = readObjectString(value, 'text')
  const title = readObjectString(value, 'title')

  const baseDomain =
    readObjectString(value, 'base_domain') || readObjectString(value, 'baseDomain')
  const headData =
    (isObjectRecord(value.head_data) && value.head_data)
    || (isObjectRecord(value.headData) && value.headData)
    || undefined
  const headExtractionStatus =
    readObjectString(value, 'head_extraction_status')
    || readObjectString(value, 'headExtractionStatus')
  const headExtractionError =
    readObjectString(value, 'head_extraction_error')
    || readObjectString(value, 'headExtractionError')
  const intrinsicScore =
    readObjectNumber(value, 'intrinsic_score') ?? readObjectNumber(value, 'intrinsicScore')
  const contextualScore =
    readObjectNumber(value, 'contextual_score') ?? readObjectNumber(value, 'contextualScore')
  const totalScore = readObjectNumber(value, 'total_score') ?? readObjectNumber(value, 'totalScore')
  const normalizedIntrinsicScore = intrinsicScore ?? 0
  const normalizedContextualScore = contextualScore ?? 0
  const normalizedTotalScore =
    totalScore ?? normalizedIntrinsicScore + normalizedContextualScore

  return {
    href,
    ...(text ? { text } : {}),
    ...(title ? { title } : {}),
    ...(baseDomain ? { baseDomain } : {}),
    ...(headData ? { headData } : {}),
    ...(headExtractionStatus ? { headExtractionStatus } : {}),
    ...(headExtractionError ? { headExtractionError } : {}),
    intrinsicScore: normalizedIntrinsicScore,
    contextualScore: normalizedContextualScore,
    totalScore: normalizedTotalScore
  }
}

const normalizeLinkList = (value: JsonValue | undefined): WebCrawlerLink[] =>
  Array.isArray(value)
    ? value
        .map((item) => normalizeLinkItem(item))
        .filter((item): item is WebCrawlerLink => Boolean(item))
    : []

const normalizeLinks = (value: JsonValue | undefined): WebCrawlerLinks => {
  if (!isObjectRecord(value)) {
    return {
      internal: [],
      external: []
    }
  }
  return {
    internal: normalizeLinkList(value.internal),
    external: normalizeLinkList(value.external)
  }
}

const normalizeResult = (payload: JsonObject): WebCrawlerResult => {
  const requestedUrl = readRequestedUrl(payload)
  if (!requestedUrl) {
    throw new Error('web crawler sidecar result missing requested url')
  }
  const finalUrl = readFinalUrl(payload)
  if (!finalUrl) {
    throw new Error('web crawler sidecar result missing final url')
  }

  const raw = isObjectRecord(payload.raw) ? payload.raw : payload
  const title =
    readObjectString(payload, 'title')
    || readObjectString(isObjectRecord(raw.metadata) ? raw.metadata : undefined, 'title')
  const markdown =
    readObjectString(payload, 'markdown')
    || readMarkdownText(payload.markdown)
    || readMarkdownText(raw.markdown)
    || readObjectString(raw, 'fit_markdown')
    || readObjectString(raw, 'fitMarkdown')
  const publishedAt =
    readObjectString(payload, 'published_at')
    || readObjectString(payload, 'publishedAt')
    || readPublishedAt(raw)
  if (!markdown) {
    throw new WebCrawlerSidecarError({
      message:
        readErrorMessage(raw)
        || readErrorMessage(payload)
        || 'web crawler sidecar result missing markdown',
      requestedUrl,
      finalUrl,
      statusCode: readStatusCode(raw) || readStatusCode(payload),
      raw: payload
    })
  }

  return {
    requestedUrl,
    finalUrl,
    ...(title ? { title } : {}),
    markdown,
    links: normalizeLinks(payload.links),
    ...(publishedAt ? { publishedAt } : {}),
    raw
  }
}

const normalizeSearchResults = (value: JsonValue | undefined): WebSearchResultItem[] => {
  if (!Array.isArray(value)) return []
  const results: WebSearchResultItem[] = []
  const seenUrls = new Set<string>()
  for (const item of value) {
    if (!isObjectRecord(item)) continue
    const title = readObjectString(item, 'title')
    const url = readObjectString(item, 'url') || readObjectString(item, 'href')
    if (!title || !url || seenUrls.has(url)) continue
    seenUrls.add(url)
    results.push({
      rank: readObjectNumber(item, 'rank') || results.length + 1,
      title,
      url,
      ...(readObjectString(item, 'snippet') || readObjectString(item, 'body')
        ? { snippet: readObjectString(item, 'snippet') || readObjectString(item, 'body') }
        : {})
    })
  }
  return results
}

const normalizeSearchResult = (payload: JsonObject): WebSearchResult => {
  const query = readObjectString(payload, 'query')
  if (!query) {
    throw new Error('web crawler sidecar search result missing query')
  }
  return {
    query,
    results: normalizeSearchResults(payload.results),
    raw: payload
  }
}

const toJsonString = (value: WebCrawlerSidecarRequest): string => `${JSON.stringify(value)}\n`

const getPackagedExecutableName = (): string =>
  process.platform === 'win32' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'

const resolveSidecarExecutablePath = (binDir: string): string => {
  const executableName = getPackagedExecutableName()
  const nestedPath = path.join(binDir, 'web_crawler_sidecar', executableName)
  if (fs.existsSync(nestedPath)) {
    return nestedPath
  }

  const flatPath = path.join(binDir, executableName)
  if (fs.existsSync(flatPath)) {
    return flatPath
  }

  return nestedPath
}

const resolvePackagedSidecarExecutablePath = (resourcesPath: string): string =>
  resolveSidecarExecutablePath(
    path.join(resourcesPath, PACKAGED_SIDECAR_DIR, PACKAGED_SIDECAR_BIN_DIR)
  )

const resolveDevelopmentSidecarExecutablePath = (appRootPath: string): string =>
  resolveSidecarExecutablePath(
    path.join(appRootPath, 'resources', 'web_crawler_sidecar', PACKAGED_SIDECAR_BIN_DIR)
  )

const assertExecutableExists = (executablePath: string, message: string): void => {
  if (fs.existsSync(executablePath)) {
    return
  }
  throw new Error(`${message}: ${executablePath}`)
}

const shouldUsePythonSidecar = (): boolean =>
  String(process.env[PYTHON_SIDECAR_DEBUG_ENV] || '').trim() === '1'

const resolveDefaultSidecarCommand = (options: WebCrawlerServiceOptions): SidecarCommand => {
  if (options.isPackaged) {
    const resourcesPath = String(options.resourcesPath || '').trim()
    if (!resourcesPath) {
      throw new Error('missing Electron resourcesPath for packaged web crawler sidecar')
    }
    const executablePath = resolvePackagedSidecarExecutablePath(resourcesPath)
    assertExecutableExists(executablePath, 'missing packaged web crawler sidecar binary')
    return {
      executablePath,
      args: [],
      env: options.sidecarEnv
    }
  }

  const appRootPath = String(options.appRootPath || '').trim()
  if (!appRootPath) {
    throw new Error('missing appRootPath for development web crawler sidecar')
  }
  if (!shouldUsePythonSidecar()) {
    const executablePath = resolveDevelopmentSidecarExecutablePath(appRootPath)
    assertExecutableExists(
      executablePath,
      'missing development web crawler sidecar binary. Run `pnpm run build:sidecar` before using web tools'
    )
    return {
      executablePath,
      args: [],
      env: options.sidecarEnv
    }
  }
  return {
    executablePath: process.env.NCURATOR_WEB_CRAWLER_SIDECAR_PYTHON || 'python3',
    args: [path.join(appRootPath, DEV_SIDECAR_SCRIPT_PATH)],
    env: options.sidecarEnv
  }
}

const validateCdpUrl = (rawUrl: string): string => {
  const parsed = new URL(rawUrl)
  if (parsed.protocol !== 'ws:' || !LOOPBACK_HOSTNAMES.has(parsed.hostname) || !parsed.port) {
    throw new Error('web crawler CDP endpoint must be a loopback WebSocket URL')
  }
  return parsed.toString()
}

const buildSidecarError = (response: WebCrawlerSidecarResponse): Error => {
  if (!('ok' in response) || response.ok) {
    return new Error('web crawler sidecar failed')
  }

  const data = isObjectRecord(response.data) ? response.data : undefined
  return new WebCrawlerSidecarError({
    message: String(response.error || 'web crawler sidecar failed'),
    requestedUrl: readRequestedUrl(data),
    finalUrl: readFinalUrl(data),
    statusCode: readStatusCode(data),
    raw: response.data
  })
}

export class ManagedWebCrawlerService implements WebCrawlerServiceContract {
  private readonly sidecarCommand: SidecarCommand
  private readonly playwrightNodeExecutablePath: string
  private readonly resolveCdpConnection?: () => Promise<WebCrawlerCdpConnection>
  private readonly requestTimeoutMs: number
  private child?: ChildProcessWithoutNullStreams
  private childStartupPromise?: Promise<ChildProcessWithoutNullStreams>
  private closed = false
  private pending = new Map<string, PendingRequest>()
  private stdoutInterface?: readline.Interface
  private stderrBuffer = ''

  public constructor(options: WebCrawlerServiceOptions = {}) {
    this.sidecarCommand = options.sidecarCommand || resolveDefaultSidecarCommand(options)
    this.playwrightNodeExecutablePath = path.resolve(
      options.playwrightNodeExecutablePath || process.execPath
    )
    assertExecutableExists(
      this.playwrightNodeExecutablePath,
      'missing Node runtime for Python Playwright'
    )
    this.resolveCdpConnection = options.resolveCdpConnection
    this.requestTimeoutMs = Math.max(
      1_000,
      Number(options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)
    )
  }

  public async crawl(input: { url: string; topic: string }): Promise<WebCrawlerResult> {
    const payload = await this.sendRequest({
      id: randomUUID(),
      action: 'crawl',
      input: {
        url: input.url,
        topic: input.topic
      }
    })
    return normalizeResult(payload)
  }

  public async search(input: { query: string }): Promise<WebSearchResult> {
    const payload = await this.sendRequest({
      id: randomUUID(),
      action: 'search',
      input: {
        query: input.query
      }
    })
    return normalizeSearchResult(payload)
  }

  public async close(): Promise<void> {
    this.closed = true
    this.rejectAllPending(new Error('web crawler sidecar closed'))
    await this.childStartupPromise?.catch(() => undefined)
    await this.stopChild()
  }

  private async ensureChild(): Promise<ChildProcessWithoutNullStreams> {
    if (this.closed) {
      throw new Error('web crawler sidecar is closed')
    }
    if (this.child && !this.child.killed) {
      return this.child
    }

    if (!this.resolveCdpConnection) {
      throw new Error('missing isolated Electron CDP connection resolver for web crawler sidecar')
    }

    this.childStartupPromise ||= this.startChild().finally(() => {
      this.childStartupPromise = undefined
    })
    return await this.childStartupPromise
  }

  private async startChild(): Promise<ChildProcessWithoutNullStreams> {
    const resolveCdpConnection = this.resolveCdpConnection
    if (!resolveCdpConnection) {
      throw new Error('missing isolated Electron CDP connection resolver for web crawler sidecar')
    }
    const connection = await resolveCdpConnection()
    if (this.closed) {
      throw new Error('web crawler sidecar is closed')
    }
    const cdpUrl = validateCdpUrl(connection.browserWebSocketUrl)
    const contextMarkerUrl = String(connection.contextMarkerUrl || '').trim()
    if (!contextMarkerUrl.startsWith('about:blank#ncurator-web-crawler-')) {
      throw new Error('invalid Electron CDP context marker for web crawler sidecar')
    }

    const child = spawn(this.sidecarCommand.executablePath, this.sidecarCommand.args, {
      cwd: this.sidecarCommand.cwd,
      env: {
        ...process.env,
        ...this.sidecarCommand.env,
        [PLAYWRIGHT_NODEJS_PATH_ENV]: this.playwrightNodeExecutablePath,
        [ELECTRON_RUN_AS_NODE_ENV]: '1',
        [SIDECAR_CDP_URL_ENV]: cdpUrl,
        [SIDECAR_CDP_CONTEXT_MARKER_ENV]: contextMarkerUrl
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    })
    this.child = child
    this.stderrBuffer = ''

    this.stdoutInterface = readline.createInterface({
      input: child.stdout
    })
    this.stdoutInterface.on('line', (line) => {
      this.handleSidecarLine(line)
    })

    child.stderr.on('data', (chunk) => {
      this.stderrBuffer += String(chunk)
      this.stderrBuffer = this.stderrBuffer.slice(-8_000)
    })

    child.on('exit', (code, signal) => {
      if (this.child === child) {
        this.stdoutInterface?.close()
        this.stdoutInterface = undefined
        this.child = undefined
      }
      if (this.pending.size > 0) {
        const suffix = this.stderrBuffer.trim()
        this.rejectAllPending(
          new Error(
            `web crawler sidecar exited unexpectedly (code=${String(code)} signal=${String(signal)})${suffix ? `: ${suffix}` : ''}`
          )
        )
      }
    })

    child.on('error', (error) => {
      this.rejectAllPending(error instanceof Error ? error : new Error(String(error)))
    })

    return child
  }

  private async stopChild(): Promise<void> {
    const child = this.child
    this.stdoutInterface?.close()
    this.stdoutInterface = undefined
    this.child = undefined
    if (!child || child.killed) return
    child.stdin.end()
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 3_000)
      child.once('exit', () => {
        clearTimeout(timer)
        resolve()
      })
    })
    if (child.exitCode === null && child.signalCode === null) {
      killSidecarTree(child)
    }
  }

  private async sendRequest(request: WebCrawlerSidecarRequest): Promise<JsonObject> {
    const child = await this.ensureChild()
    return await new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
        this.childStartupPromise = undefined
        void this.stopChild()
        reject(new Error('web crawler sidecar request timeout'))
      }, this.requestTimeoutMs)

      this.pending.set(request.id, { resolve, reject, timer })
      child.stdin.write(toJsonString(request), (error) => {
        if (!error) return
        const pending = this.pending.get(request.id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(request.id)
        reject(error)
      })
    })
  }

  private handleSidecarLine(line: string): void {
    const text = line.trim()
    if (!text) return
    if (!text.startsWith('{')) {
      this.stderrBuffer += `${text}\n`
      this.stderrBuffer = this.stderrBuffer.slice(-8_000)
      return
    }

    let parsed: WebCrawlerSidecarResponse
    try {
      parsed = JSON.parse(text) as WebCrawlerSidecarResponse
    } catch {
      this.rejectAllPending(new Error(`invalid web crawler sidecar JSON: ${text}`))
      return
    }

    const pending = this.pending.get(parsed.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(parsed.id)
    if (!parsed.ok) {
      pending.reject(buildSidecarError(parsed))
      return
    }
    pending.resolve(parsed.data)
  }

  private rejectAllPending(error: Error): void {
    const pendingEntries = [...this.pending.values()]
    this.pending.clear()
    for (const pending of pendingEntries) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }
}
