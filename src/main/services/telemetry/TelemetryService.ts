import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { officialApiUrl, type AppDistribution } from '../../../shared/appPreferences'
import { freeModelEntryIdFromConfigId } from '../../../shared/freeModels'
import type { WorkbenchSelectedModel } from '../../../shared/types'
import { getAppRuntime } from '../app/AppRuntime'
import { FreeModelCatalogService } from '../llm/FreeModelCatalogService'
import { PresetModelCatalogService } from '../llm/PresetModelCatalogService'
import { buildDesktopAppGatewayHeaders } from '../officialApi/appClient'

export type TelemetryEventName = 'app_started' | 'message_submitted' | 'run_finished'
export type TelemetryFailureCode = 'llm_request_failed' | 'output_truncated' | 'input_too_long' | 'runtime_limit' | 'internal_error' | 'unexpected_error' | 'process_interrupted'
export type RunModelTelemetry = { modelSource: 'managed' | 'free' | 'custom'; modelRef?: string }
export type RunTelemetryMetadata = { outcome: 'completed'; model?: RunModelTelemetry } |
  { outcome: 'cancelled' } | { outcome: 'failed'; failureCode: TelemetryFailureCode }

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
  installationId: string
  platform: 'win32' | 'darwin' | 'linux' | 'other'
  arch: 'x64' | 'arm64' | 'ia32' | 'other'
  appVersion: string
  outcome?: 'completed' | 'failed' | 'cancelled'
  failureCode?: TelemetryFailureCode
  modelSource?: RunModelTelemetry['modelSource']
  modelRef?: string
}

type PersistedTelemetryState = {
  schemaVersion: 1
  distribution: AppDistribution
  installationId: string
  pending: TelemetryEventPayload[]
}

type DeliveryResult = 'accepted' | 'discard' | { retryAfterMs: number }

const MAX_PENDING_EVENTS = 500
const RETRY_BACKOFF_MS = 30_000
const MAX_TIMER_DELAY_MS = 2_147_483_647
const DELIVERY_TIMEOUT_MS = 20_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP_VERSION_PATTERN = /^[0-9A-Za-z._+-]{1,64}$/
const MODEL_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const MODEL_SOURCES = new Set(['managed', 'free', 'custom'])
const TELEMETRY_PLATFORMS = new Set(['win32', 'darwin', 'linux', 'other'])
const TELEMETRY_ARCHES = new Set(['x64', 'arm64', 'ia32', 'other'])
const TELEMETRY_FAILURE_CODES = new Set<TelemetryFailureCode>([
  'llm_request_failed', 'output_truncated', 'input_too_long', 'runtime_limit', 'internal_error', 'unexpected_error', 'process_interrupted'
])

const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID_PATTERN.test(value)

const isE2ERuntime = (): boolean =>
  Boolean(
    process.env.NCURATOR_E2E_MODE ||
    process.env.NCURATOR_E2E_OBSERVER ||
    process.env.NCURATOR_E2E_APP_TARGET
  )

const shouldEnableTelemetry = (isPackaged: boolean): boolean => {
  return isPackaged && !isE2ERuntime()
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
    (['app_started', 'message_submitted', 'run_finished'].includes(event.eventName || '')) &&
    event.source === 'desktop' &&
    typeof event.platform === 'string' &&
    TELEMETRY_PLATFORMS.has(event.platform) &&
    typeof event.arch === 'string' &&
    TELEMETRY_ARCHES.has(event.arch) &&
    typeof event.appVersion === 'string' &&
    APP_VERSION_PATTERN.test(event.appVersion)
  if (!hasValidBase || Object.keys(event).some(key => !['eventId', 'eventName', 'source', 'installationId', 'platform', 'arch', 'appVersion', 'outcome', 'failureCode', 'modelSource', 'modelRef'].includes(key))) return false
  const hasModel = event.modelSource !== undefined || event.modelRef !== undefined
  if (hasModel && (event.eventName !== 'run_finished' || event.outcome !== 'completed' ||
    !event.modelSource || !MODEL_SOURCES.has(event.modelSource) ||
    (event.modelRef !== undefined && (typeof event.modelRef !== 'string' || !MODEL_REF_PATTERN.test(event.modelRef))))) return false
  if (event.eventName !== 'run_finished') {
    return event.outcome === undefined && event.failureCode === undefined
  }
  if (!['completed', 'cancelled', 'failed'].includes(event.outcome || '')) {
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

function retryDelay(response: Response): number {
  const header = response.headers.get('retry-after')?.trim()
  if (!header) return RETRY_BACKOFF_MS
  const delay = /^\d+$/.test(header) ? Number(header) * 1_000 : Date.parse(header) - Date.now()
  return Number.isFinite(delay) ? Math.min(MAX_TIMER_DELAY_MS, Math.max(1_000, delay)) : RETRY_BACKOFF_MS
}

async function readStateFile<T>(filename: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filename, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

export class TelemetryService {
  private readonly distribution = getAppRuntime().distribution
  private readonly statePath: string
  private readonly identityPath: string
  private readonly legacyPath: string
  private readonly endpoint: string
  private readonly enabled: boolean
  private readonly shutdown = new AbortController()
  private state: PersistedTelemetryState | undefined
  private operationChain: Promise<void> = Promise.resolve()
  private retryTimer: NodeJS.Timeout | undefined

  public constructor(private readonly options: TelemetryServiceOptions) {
    this.statePath = path.join(options.userDataPath, `telemetry-${this.distribution}.json`)
    this.identityPath = path.join(options.userDataPath, 'telemetry-installation.json')
    this.legacyPath = path.join(options.userDataPath, 'telemetry.json')
    this.endpoint = options.endpoint?.trim() || officialApiUrl(this.distribution, '/api/telemetry/events')
    this.enabled = shouldEnableTelemetry(options.isPackaged)
  }

  public captureRunModel(selection: WorkbenchSelectedModel): RunModelTelemetry | undefined {
    if (!this.enabled || typeof selection.configId !== 'string') return undefined
    try {
      const managed = /^managed:([1-9][0-9]{0,18})$/.exec(selection.configId)?.[1]
      if (managed && this.distribution === 'domestic' && BigInt(managed) <= 9_223_372_036_854_775_807n) {
        return { modelSource: 'managed', modelRef: managed }
      }
      const free = freeModelEntryIdFromConfigId(selection.configId)
      if (free) {
        const entry = FreeModelCatalogService.getInstance().findEntryById(free)
        const ref = entry?.executionId ?? entry?.id
        return { modelSource: 'free', ...(ref && MODEL_REF_PATTERN.test(ref) && { modelRef: ref }) }
      }
      const preset = selection.manual ? null : PresetModelCatalogService.getInstance().findModelById(selection.modelName)
      return { modelSource: 'custom', ...(preset && MODEL_REF_PATTERN.test(preset.id) && { modelRef: preset.id }) }
    } catch {
      return undefined
    }
  }

  public track(eventName: 'app_started' | 'message_submitted'): void
  public track(eventName: 'run_finished', metadata: RunTelemetryMetadata, eventId: string): void
  public track(eventName: TelemetryEventName, metadata?: RunTelemetryMetadata, eventId?: string): void {
    if (!this.enabled || this.shutdown.signal.aborted) return
    if (eventName === 'run_finished' && (!metadata || !eventId)) return
    this.operationChain = this.operationChain
      .then(async () => await this.enqueueAndDrain(eventName, metadata, eventId))
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

  public async dispose(): Promise<void> {
    this.shutdown.abort()
    clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    await this.flush()
  }

  private async enqueueAndDrain(
    eventName: TelemetryEventName,
    metadata?: RunTelemetryMetadata,
    eventId?: string
  ): Promise<void> {
    const state = this.state ??= await this.loadState()
    const event = this.createPayload(state.installationId, eventName, metadata, eventId)
    if (!state.pending.some(item => item.eventId === event.eventId)) state.pending.push(event)
    if (state.pending.length > MAX_PENDING_EVENTS) {
      state.pending.splice(0, state.pending.length - MAX_PENDING_EVENTS)
    }
    await this.persistAndDrain(state)
  }

  private async persistAndDrain(state: PersistedTelemetryState): Promise<void> {
    try {
      await this.persistFile(this.statePath, state)
    } catch {
      this.scheduleRetry(state, RETRY_BACKOFF_MS)
      return
    }
    if (!this.retryTimer) await this.drain(state)
  }

  private createPayload(
    installationId: string,
    eventName: TelemetryEventName,
    metadata?: RunTelemetryMetadata,
    eventId?: string
  ): TelemetryEventPayload {
    const base: TelemetryEventPayload = {
      eventId: eventId || randomUUID(),
      eventName,
      source: 'desktop',
      installationId,
      platform: normalizePlatform(),
      arch: normalizeArch(),
      appVersion: this.options.appVersion
    }
    if (eventName !== 'run_finished') return base
    if (!metadata) throw new Error('run_finished requires metadata')
    return {
      ...base,
      outcome: metadata.outcome,
      ...(metadata.outcome === 'failed' ? { failureCode: metadata.failureCode } : {}),
      ...(metadata.outcome === 'completed' && metadata.model && {
        modelSource: metadata.model.modelSource, modelRef: metadata.model.modelRef
      })
    }
  }

  private scheduleRetry(state: PersistedTelemetryState, delay: number): void {
    if (this.retryTimer || this.shutdown.signal.aborted || !state.pending.length) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      this.operationChain = this.operationChain
        .then(async () => await this.persistAndDrain(state))
        .catch(() => undefined)
    }, delay)
    this.retryTimer.unref()
  }

  private async drain(state: PersistedTelemetryState): Promise<void> {
    while (!this.shutdown.signal.aborted && state.pending.length > 0) {
      const result = await this.deliver(state.pending[0])
      if (typeof result === 'object') {
        this.scheduleRetry(state, result.retryAfterMs)
        return
      }
      state.pending.shift()
      try {
        await this.persistFile(this.statePath, state)
      } catch {
        this.scheduleRetry(state, RETRY_BACKOFF_MS)
        return
      }
    }
  }

  private async deliver(event: TelemetryEventPayload): Promise<DeliveryResult> {
    const fallback = { retryAfterMs: RETRY_BACKOFF_MS }
    try {
      const body = JSON.stringify(event)
      const response = await fetch(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...buildDesktopAppGatewayHeaders({
            method: 'POST',
            url: this.endpoint,
            body
          })
        },
        signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(DELIVERY_TIMEOUT_MS)]),
        body
      })
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        if (response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) {
          return 'discard'
        }
        return { retryAfterMs: retryDelay(response) }
      }
      const result = (await response.json().catch(() => null)) as { accepted?: unknown } | null
      return result?.accepted === true ? 'accepted' : fallback
    } catch {
      return fallback
    }
  }

  private async loadState(): Promise<PersistedTelemetryState> {
    const identity = await readStateFile<{ installationId?: string }>(this.identityPath)
    const legacy = await readStateFile<{
      schemaVersion?: number
      installationId?: string
      clientId?: string
      pending?: TelemetryEventPayload[]
    }>(this.legacyPath)
    const installationId = [identity?.installationId, legacy?.installationId, legacy?.clientId].find(isUuid) ?? randomUUID()
    if (identity?.installationId !== installationId) {
      await this.persistFile(this.identityPath, { installationId })
    }
    if (legacy?.pending?.length) {
      await this.persistFile(this.legacyPath, {
        schemaVersion: legacy.schemaVersion, installationId, clientId: legacy.clientId, pending: []
      })
    }

    const queue = await readStateFile<PersistedTelemetryState>(this.statePath)
    return {
      schemaVersion: 1,
      distribution: this.distribution,
      installationId,
      pending: queue?.schemaVersion === 1 && queue.distribution === this.distribution && Array.isArray(queue.pending)
        ? queue.pending.filter(isPendingEvent).filter(event => event.installationId === installationId)
        : []
    }
  }

  private async persistFile(filename: string, state: object): Promise<void> {
    const temporaryPath = `${filename}.${process.pid}.${randomUUID()}.tmp`
    try {
      await mkdir(this.options.userDataPath, { recursive: true })
      await writeFile(temporaryPath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 })
      await rename(temporaryPath, filename)
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}
