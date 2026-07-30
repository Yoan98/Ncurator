import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type TelemetryEventName =
  | 'app_started'
  | 'message_submit_requested'
  | 'message_submit_succeeded'
  | 'message_submit_failed'

type TelemetryMetadata = {
  mode?: 'ai' | 'search'
  failureCode?: 'REQUEST_FAILED' | 'NETWORK' | 'UNKNOWN'
}

type TelemetryServiceOptions = {
  userDataPath: string
  appVersion: string
  isPackaged: boolean
  endpoint?: string
}

const DEFAULT_ENDPOINT = 'https://www.ncurator.com/api/telemetry/events'

export class TelemetryService {
  private readonly clientIdPath: string
  private readonly endpoint: string
  private clientIdPromise: Promise<string> | null = null

  public constructor(private readonly options: TelemetryServiceOptions) {
    this.clientIdPath = path.join(options.userDataPath, 'telemetry.json')
    this.endpoint = String(options.endpoint || DEFAULT_ENDPOINT).trim()
  }

  public track(eventName: TelemetryEventName, metadata: TelemetryMetadata = {}): void {
    if (!this.options.isPackaged && process.env.NCURATOR_TELEMETRY_ENABLED !== '1') return
    void this.send(eventName, metadata)
  }

  private async send(eventName: TelemetryEventName, metadata: TelemetryMetadata): Promise<void> {
    try {
      const clientId = await this.getClientId()
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(2_000),
        body: JSON.stringify({
          eventId: randomUUID(),
          eventName,
          source: 'desktop',
          clientId,
          platform: process.platform,
          arch: process.arch,
          appVersion: this.options.appVersion,
          ...metadata
        })
      })
    } catch {
      // 埋点失败不影响用户操作，也不做本地重试队列。
    }
  }

  private async getClientId(): Promise<string> {
    if (!this.clientIdPromise) this.clientIdPromise = this.loadOrCreateClientId()
    return await this.clientIdPromise
  }

  private async loadOrCreateClientId(): Promise<string> {
    try {
      const raw = await readFile(this.clientIdPath, 'utf8')
      const parsed = JSON.parse(raw) as { clientId?: unknown }
      if (typeof parsed.clientId === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.clientId)) {
        return parsed.clientId
      }
    } catch {
      // 首次运行或文件损坏时创建新 ID。
    }

    const clientId = randomUUID()
    try {
      await mkdir(this.options.userDataPath, { recursive: true })
      await writeFile(this.clientIdPath, JSON.stringify({ clientId }), { encoding: 'utf8', mode: 0o600 })
    } catch {
      // 即使 ID 无法持久化，应用也继续运行；本次事件仍可使用该 ID。
    }
    return clientId
  }
}
