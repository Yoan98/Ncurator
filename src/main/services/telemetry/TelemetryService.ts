import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { officialUrl } from '../../../shared/appPreferences'
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
  schemaVersion: 3
  installationId: string
  pending: TelemetryEventPayload[]
}

type DeliveryResult = 'accepted' | 'discard' | 'retry'

const MAX_PENDING_EVENTS = 500
const RETRY_BACKOFF_MS = 30_000
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

export class TelemetryService {
  private readonly statePath: string
  private readonly endpoint: string | undefined
  private readonly enabled: boolean
  private statePromise: Promise<PersistedTelemetryState> | null = null
  private operationChain: Promise<void> = Promise.resolve()
  private retryAfter = 0

  public constructor(private readonly options: TelemetryServiceOptions) {
    this.statePath = path.join(options.userDataPath, 'telemetry.json')
    this.endpoint = options.endpoint?.trim() || undefined
    this.enabled = shouldEnableTelemetry(options.isPackaged)
  }

  public captureRunModel(selection: WorkbenchSelectedModel): RunModelTelemetry | undefined {
    if (!this.enabled || typeof selection.configId !== 'string') return undefined
    try {
      const managed = /^managed:([1-9][0-9]{0,18})$/.exec(selection.configId)?.[1]
      if (managed && getAppRuntime().distribution === 'domestic' && BigInt(managed) <= 9_223_372_036_854_775_807n) {
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
    if (!this.enabled) return
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

  private async enqueueAndDrain(
    eventName: TelemetryEventName,
    metadata?: RunTelemetryMetadata,
    eventId?: string
  ): Promise<void> {
    const state = await this.getState()
    const event = this.createPayload(state.installationId, eventName, metadata, eventId)
    if (!state.pending.some(item => item.eventId === event.eventId)) state.pending.push(event)
    if (state.pending.length > MAX_PENDING_EVENTS) {
      state.pending.splice(0, state.pending.length - MAX_PENDING_EVENTS)
    }
    if (!(await this.persistState(state))) return
    await this.drain(state)
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
      const endpoint =
        this.endpoint || officialUrl(getAppRuntime().distribution, '/api/telemetry/events')
      const body = JSON.stringify(event)
      const response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          ...buildDesktopAppGatewayHeaders({
            method: 'POST',
            url: endpoint,
            body
          })
        },
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        body
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
        schemaVersion?: number
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
        schemaVersion: 3,
        installationId,
        pending: parsed.schemaVersion === 3 && Array.isArray(parsed.pending)
          ? parsed.pending
              .filter(isPendingEvent)
              .filter((event) => event.installationId === installationId)
          : []
      }
    } catch {
      return {
        schemaVersion: 3,
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
