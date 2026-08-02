import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export type TelemetryEventName = 'app_started' | 'message_submit_completed'

type TelemetryFailureCode = 'REQUEST_FAILED' | 'NETWORK' | 'UNKNOWN'

export type MessageSubmitTelemetryMetadata =
  | {
      mode: 'ai' | 'search'
      outcome: 'succeeded'
      failureCode?: never
    }
  | {
      mode: 'ai' | 'search'
      outcome: 'failed'
      failureCode: TelemetryFailureCode
    }

type TelemetryEnvironment = 'production' | 'development' | 'e2e'

type TelemetryServiceOptions = {
  userDataPath: string
  appVersion: string
  isPackaged: boolean
  endpoint?: string
}

type TelemetryEventPayload = {
  eventId: string
  eventName: TelemetryEventName
  source: 'desktop'
  environment: TelemetryEnvironment
  installationId: string
  platform: 'win32' | 'darwin' | 'linux' | 'other'
  arch: 'x64' | 'arm64' | 'ia32' | 'other'
  appVersion: string
  mode?: 'ai' | 'search'
  outcome?: 'succeeded' | 'failed'
  failureCode?: TelemetryFailureCode
}

type PersistedTelemetryState = {
  schemaVersion: 2
  installationId: string
  pending: TelemetryEventPayload[]
}

type DeliveryResult = 'accepted' | 'discard' | 'retry'

const DEFAULT_ENDPOINT = 'https://www.ncurator.com/api/telemetry/events'
const MAX_PENDING_EVENTS = 500
const RETRY_BACKOFF_MS = 30_000
const DELIVERY_TIMEOUT_MS = 20_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP_VERSION_PATTERN = /^[0-9A-Za-z._+-]{1,64}$/
const TELEMETRY_PLATFORMS = new Set(['win32', 'darwin', 'linux', 'other'])
const TELEMETRY_ARCHES = new Set(['x64', 'arm64', 'ia32', 'other'])
const TELEMETRY_FAILURE_CODES = new Set<TelemetryFailureCode>([
  'REQUEST_FAILED',
  'NETWORK',
  'UNKNOWN'
])

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value)

const isE2ERuntime = (): boolean =>
  Boolean(
    process.env.NCURATOR_E2E_MODE ||
    process.env.NCURATOR_E2E_OBSERVER ||
    process.env.NCURATOR_E2E_APP_TARGET
  )

const resolveEnvironment = (isPackaged: boolean): TelemetryEnvironment => {
  if (isE2ERuntime()) return 'e2e'
  return isPackaged ? 'production' : 'development'
}

const shouldEnableTelemetry = (isPackaged: boolean): boolean => {
  const override = String(process.env.NCURATOR_TELEMETRY_ENABLED || '').trim()
  if (override === '0') return false
  if (isE2ERuntime()) return override === '1'
  if (isPackaged) return true
  return override === '1'
}

const normalizePlatform = (): TelemetryEventPayload['platform'] => {
  if (
    process.platform === 'win32' ||
    process.platform === 'darwin' ||
    process.platform === 'linux'
  ) {
    return process.platform
  }
  return 'other'
}

const normalizeArch = (): TelemetryEventPayload['arch'] => {
  if (process.arch === 'x64' || process.arch === 'arm64' || process.arch === 'ia32') {
    return process.arch
  }
  return 'other'
}

const isPendingEvent = (value: unknown): value is TelemetryEventPayload => {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<TelemetryEventPayload>
  const hasValidBase =
    isUuid(event.eventId) &&
    isUuid(event.installationId) &&
    (event.eventName === 'app_started' || event.eventName === 'message_submit_completed') &&
    event.source === 'desktop' &&
    (event.environment === 'production' ||
      event.environment === 'development' ||
      event.environment === 'e2e') &&
    typeof event.platform === 'string' &&
    TELEMETRY_PLATFORMS.has(event.platform) &&
    typeof event.arch === 'string' &&
    TELEMETRY_ARCHES.has(event.arch) &&
    typeof event.appVersion === 'string' &&
    APP_VERSION_PATTERN.test(event.appVersion)
  if (!hasValidBase) return false
  if (event.eventName === 'app_started') {
    return (
      event.mode === undefined && event.outcome === undefined && event.failureCode === undefined
    )
  }
  if (
    (event.mode !== 'ai' && event.mode !== 'search') ||
    (event.outcome !== 'succeeded' && event.outcome !== 'failed')
  ) {
    return false
  }
  if (event.outcome === 'failed') {
    return (
      typeof event.failureCode === 'string' &&
      TELEMETRY_FAILURE_CODES.has(event.failureCode as TelemetryFailureCode)
    )
  }
  return event.failureCode === undefined
}

export class TelemetryService {
  private readonly statePath: string
  private readonly endpoint: string
  private readonly enabled: boolean
  private readonly environment: TelemetryEnvironment
  private statePromise: Promise<PersistedTelemetryState> | null = null
  private operationChain: Promise<void> = Promise.resolve()
  private retryAfter = 0

  public constructor(private readonly options: TelemetryServiceOptions) {
    this.statePath = path.join(options.userDataPath, 'telemetry.json')
    this.endpoint = String(options.endpoint || DEFAULT_ENDPOINT).trim()
    this.enabled = shouldEnableTelemetry(options.isPackaged)
    this.environment = resolveEnvironment(options.isPackaged)
  }

  public track(eventName: 'app_started'): void
  public track(
    eventName: 'message_submit_completed',
    metadata: MessageSubmitTelemetryMetadata
  ): void
  public track(eventName: TelemetryEventName, metadata?: MessageSubmitTelemetryMetadata): void {
    if (!this.enabled) return
    if (eventName === 'message_submit_completed' && !metadata) return
    this.operationChain = this.operationChain
      .then(async () => await this.enqueueAndDrain(eventName, metadata))
      .catch(() => undefined)
  }

  public async flush(timeoutMs = 3_000): Promise<void> {
    if (!this.enabled) return
    let timeout: NodeJS.Timeout | undefined
    try {
      await Promise.race([
        this.operationChain,
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, timeoutMs)
        })
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private async enqueueAndDrain(
    eventName: TelemetryEventName,
    metadata?: MessageSubmitTelemetryMetadata
  ): Promise<void> {
    const state = await this.getState()
    state.pending.push(this.createPayload(state.installationId, eventName, metadata))
    if (state.pending.length > MAX_PENDING_EVENTS) {
      state.pending.splice(0, state.pending.length - MAX_PENDING_EVENTS)
    }
    if (!(await this.persistState(state))) return
    await this.drain(state)
  }

  private createPayload(
    installationId: string,
    eventName: TelemetryEventName,
    metadata?: MessageSubmitTelemetryMetadata
  ): TelemetryEventPayload {
    const base: TelemetryEventPayload = {
      eventId: randomUUID(),
      eventName,
      source: 'desktop',
      environment: this.environment,
      installationId,
      platform: normalizePlatform(),
      arch: normalizeArch(),
      appVersion: this.options.appVersion
    }
    if (eventName === 'app_started') return base
    if (!metadata) throw new Error('message_submit_completed requires metadata')
    return {
      ...base,
      mode: metadata.mode,
      outcome: metadata.outcome,
      ...(metadata.outcome === 'failed' ? { failureCode: metadata.failureCode } : {})
    }
  }

  private async drain(state: PersistedTelemetryState): Promise<void> {
    if (Date.now() < this.retryAfter) return
    while (state.pending.length > 0) {
      const result = await this.deliver(state.pending[0])
      if (result === 'retry') {
        this.retryAfter = Date.now() + RETRY_BACKOFF_MS
        return
      }
      state.pending.shift()
      if (!(await this.persistState(state))) return
    }
  }

  private async deliver(event: TelemetryEventPayload): Promise<DeliveryResult> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        body: JSON.stringify(event)
      })
      if (!response.ok) {
        if (
          response.status >= 400 &&
          response.status < 500 &&
          ![408, 429].includes(response.status)
        ) {
          return 'discard'
        }
        return 'retry'
      }
      const result = (await response.json().catch(() => null)) as { accepted?: unknown } | null
      return result?.accepted === true ? 'accepted' : 'retry'
    } catch {
      return 'retry'
    }
  }

  private async getState(): Promise<PersistedTelemetryState> {
    if (!this.statePromise) this.statePromise = this.loadState()
    return await this.statePromise
  }

  private async loadState(): Promise<PersistedTelemetryState> {
    try {
      const raw = await readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw) as {
        installationId?: unknown
        clientId?: unknown
        pending?: unknown
      }
      const installationId = isUuid(parsed.installationId)
        ? parsed.installationId
        : isUuid(parsed.clientId)
          ? parsed.clientId
          : randomUUID()
      return {
        schemaVersion: 2,
        installationId,
        pending: Array.isArray(parsed.pending)
          ? parsed.pending
              .filter(isPendingEvent)
              .filter((event) => event.installationId === installationId)
          : []
      }
    } catch {
      return {
        schemaVersion: 2,
        installationId: randomUUID(),
        pending: []
      }
    }
  }

  private async persistState(state: PersistedTelemetryState): Promise<boolean> {
    const temporaryPath = `${this.statePath}.${process.pid}.${randomUUID()}.tmp`
    try {
      await mkdir(this.options.userDataPath, { recursive: true })
      await writeFile(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, this.statePath)
      return true
    } catch {
      // Telemetry persistence must never affect product behavior.
      await rm(temporaryPath, { force: true }).catch(() => undefined)
      return false
    }
  }
}
