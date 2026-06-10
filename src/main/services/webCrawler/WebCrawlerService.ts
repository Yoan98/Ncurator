import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import type { JsonObject, JsonValue } from '../../../shared/types'
import type {
  WebCrawlerLink,
  WebCrawlerResult,
  WebCrawlerService as WebCrawlerServiceContract,
  WebCrawlerSidecarRequest,
  WebCrawlerSidecarResponse
} from './types'

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

type WebCrawlerServiceOptions = {
  sidecarCommand?: SidecarCommand
  appRootPath?: string
  isPackaged?: boolean
  resourcesPath?: string
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const PACKAGED_SIDECAR_DIR = 'web_crawler_sidecar'
const PACKAGED_SIDECAR_BIN_DIR = 'bin'
const DEV_SIDECAR_SCRIPT_PATH = path.join(
  'resources',
  'web_crawler_sidecar',
  'web_crawler_sidecar.py'
)

const isObjectRecord = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

const flattenLinkCollection = (value: JsonValue | undefined): WebCrawlerLink[] => {
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenLinkCollection(item))
  }
  if (!isObjectRecord(value)) return []

  const directHref = readObjectString(value, 'href')
  if (directHref) {
    return [
      {
        href: directHref,
        ...(readObjectString(value, 'text') ? { text: readObjectString(value, 'text') } : {})
      }
    ]
  }

  return Object.values(value).flatMap((item) => flattenLinkCollection(item))
}

const normalizeLinks = (value: JsonValue | undefined): WebCrawlerLink[] => {
  const deduped = new Map<string, WebCrawlerLink>()
  for (const link of flattenLinkCollection(value)) {
    if (!deduped.has(link.href)) {
      deduped.set(link.href, link)
    }
  }
  return [...deduped.values()]
}

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
  public readonly finalUrl?: string
  public readonly statusCode?: number
  public readonly raw?: JsonValue

  public constructor(input: {
    message: string
    finalUrl?: string
    statusCode?: number
    raw?: JsonValue
  }) {
    super(input.message)
    this.name = 'WebCrawlerSidecarError'
    this.finalUrl = input.finalUrl
    this.statusCode = input.statusCode
    this.raw = input.raw
  }
}

const selectPrimaryRawResult = (payload: JsonObject): JsonObject | undefined => {
  const direct =
    (isObjectRecord(payload.selected_result) && payload.selected_result)
    || (isObjectRecord(payload.selectedResult) && payload.selectedResult)
    || (isObjectRecord(payload.result) && payload.result)
  if (direct) return direct

  const visited = Array.isArray(payload.visited_results)
    ? payload.visited_results
    : Array.isArray(payload.visitedResults)
      ? payload.visitedResults
      : []
  return visited.find(isObjectRecord)
}

const readFinalUrl = (obj: JsonObject | undefined): string | undefined =>
  readObjectString(obj, 'final_url')
  || readObjectString(obj, 'finalUrl')
  || readObjectString(obj, 'redirected_url')
  || readObjectString(obj, 'redirectedUrl')
  || readObjectString(obj, 'url')

const normalizeResult = (payload: JsonObject): WebCrawlerResult => {
  const rawPrimary = selectPrimaryRawResult(payload)
  if (!rawPrimary) {
    throw new Error('web crawler sidecar returned no selected result')
  }

  const finalUrl = readFinalUrl(rawPrimary)
  if (!finalUrl) {
    throw new Error('web crawler sidecar result missing final url')
  }

  const title =
    readObjectString(rawPrimary, 'title')
    || readObjectString(isObjectRecord(rawPrimary.metadata) ? rawPrimary.metadata : undefined, 'title')
  const markdown =
    readMarkdownText(rawPrimary.markdown)
    || readObjectString(rawPrimary, 'fit_markdown')
    || readObjectString(rawPrimary, 'fitMarkdown')
    || readObjectString(rawPrimary, 'markdown')
  const publishedAt = readPublishedAt(rawPrimary)
  if (!markdown) {
    throw new WebCrawlerSidecarError({
      message:
        readErrorMessage(rawPrimary)
        || readErrorMessage(payload)
        || 'web crawler sidecar result missing markdown',
      finalUrl,
      statusCode: readStatusCode(rawPrimary) || readStatusCode(payload),
      raw: payload
    })
  }

  return {
    finalUrl,
    ...(title ? { title } : {}),
    markdown,
    links: normalizeLinks(rawPrimary.links),
    ...(publishedAt ? { publishedAt } : {}),
    raw: payload
  }
}

const toJsonString = (value: unknown): string => `${JSON.stringify(value)}\n`

const getPackagedExecutableName = (): string =>
  process.platform === 'win32' ? 'web_crawler_sidecar.exe' : 'web_crawler_sidecar'

const resolvePackagedSidecarExecutablePath = (resourcesPath: string): string => {
  const executableName = getPackagedExecutableName()
  const binDir = path.join(resourcesPath, PACKAGED_SIDECAR_DIR, PACKAGED_SIDECAR_BIN_DIR)
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

const resolveDefaultSidecarCommand = (options: WebCrawlerServiceOptions): SidecarCommand => {
  if (options.isPackaged) {
    const resourcesPath = String(options.resourcesPath || '').trim()
    if (!resourcesPath) {
      throw new Error('missing Electron resourcesPath for packaged web crawler sidecar')
    }
    return {
      executablePath: resolvePackagedSidecarExecutablePath(resourcesPath),
      args: []
    }
  }

  const appRootPath = String(options.appRootPath || '').trim()
  if (!appRootPath) {
    throw new Error('missing appRootPath for development web crawler sidecar')
  }
  return {
    executablePath: process.env.NCURATOR_WEB_CRAWLER_SIDECAR_PYTHON || 'python3',
    args: [path.join(appRootPath, DEV_SIDECAR_SCRIPT_PATH)]
  }
}

const buildSidecarError = (response: WebCrawlerSidecarResponse): Error => {
  if (!('ok' in response) || response.ok) {
    return new Error('web crawler sidecar failed')
  }

  const data = isObjectRecord(response.data) ? response.data : undefined
  return new WebCrawlerSidecarError({
    message: String(response.error || 'web crawler sidecar failed'),
    finalUrl: readFinalUrl(data),
    statusCode: readStatusCode(data),
    raw: response.data
  })
}

export class ManagedWebCrawlerService implements WebCrawlerServiceContract {
  private readonly sidecarCommand: SidecarCommand
  private readonly requestTimeoutMs: number
  private child?: ChildProcessWithoutNullStreams
  private pending = new Map<string, PendingRequest>()
  private stdoutInterface?: readline.Interface
  private stderrBuffer = ''

  public constructor(options: WebCrawlerServiceOptions = {}) {
    this.sidecarCommand = options.sidecarCommand || resolveDefaultSidecarCommand(options)
    this.requestTimeoutMs = Math.max(
      1_000,
      Number(options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS)
    )
  }

  public async crawl(input: { url: string; topic?: string }): Promise<WebCrawlerResult> {
    const payload = await this.sendRequest({
      id: randomUUID(),
      action: 'crawl',
      input: {
        url: input.url,
        ...(input.topic ? { topic: input.topic } : {})
      }
    })
    return normalizeResult(payload)
  }

  public async close(): Promise<void> {
    this.rejectAllPending(new Error('web crawler sidecar closed'))
    await this.stopChild()
  }

  private ensureChild(): ChildProcessWithoutNullStreams {
    if (this.child && !this.child.killed) {
      return this.child
    }

    const child = spawn(this.sidecarCommand.executablePath, this.sidecarCommand.args, {
      cwd: this.sidecarCommand.cwd,
      env: {
        ...process.env,
        ...this.sidecarCommand.env
      },
      stdio: ['pipe', 'pipe', 'pipe']
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
      this.stdoutInterface?.close()
      this.stdoutInterface = undefined
      this.child = undefined
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
    child.kill()
  }

  private async sendRequest(request: WebCrawlerSidecarRequest): Promise<JsonObject> {
    const child = this.ensureChild()
    return await new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.id)
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

    let parsed: WebCrawlerSidecarResponse
    try {
      parsed = JSON.parse(text) as WebCrawlerSidecarResponse
    } catch (error) {
      this.rejectAllPending(
        error instanceof Error ? error : new Error(`invalid web crawler sidecar JSON: ${text}`)
      )
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
