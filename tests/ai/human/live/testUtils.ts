import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AiArtifactRef,
  AiRunEvent,
  DocumentRecord,
  SearchResult,
  SelectedReference
} from '../../../../src/shared/types'
import { invokeStructuredChat } from '../../../../src/main/services/ai/structuredOutput'
import { hasLiveLlmConfigInEnv, loadLiveLlmConfigFromEnv } from '../../../harness/backend/llmConfig'
import type {
  CreateAiRunContextInput,
  LiveLlmConfig,
  TestDocumentsStoreOverrides
} from '../../../harness/backend/test-types'
import { createTestDocumentRecord, createTestSearchResult } from '../../tool/testHelpers'
import { filterAiRunEventsByType } from '../testUtils'

export const KB_TOOL_NAMES = [
  'kb_list_documents',
  'kb_hybrid_search_chunks',
  'kb_vector_search_chunks',
  'kb_fts_search_chunks'
] as const

export const DOCX_READ_TOOL_NAMES = [
  'docx_open',
  'docx_outline',
  'docx_get_block',
  'docx_search',
  'docx_get_history'
] as const

export const DOCX_LOCATION_TOOL_NAMES = ['docx_outline', 'docx_get_block', 'docx_search'] as const

export const DOCX_WRITE_TOOL_NAMES = ['docx_apply_ops', 'docx_rollback'] as const

export const DOCX_DELIVERY_TOOL_NAMES = [
  'docx_validate',
  'docx_render_preview',
  'docx_save'
] as const

export const HUMAN_LIVE_PRIMARY_READY = hasLiveLlmConfigInEnv('primary')
export const HUMAN_LIVE_STRONG_READY = hasLiveLlmConfigInEnv('strong')

export const HUMAN_LIVE_PRIMARY_MODEL: LiveLlmConfig | null = HUMAN_LIVE_PRIMARY_READY
  ? loadLiveLlmConfigFromEnv('primary')
  : null

export const HUMAN_LIVE_STRONG_MODEL: LiveLlmConfig | null = HUMAN_LIVE_STRONG_READY
  ? loadLiveLlmConfigFromEnv('strong')
  : null

const LIVE_PROGRESS_DEBUG_ENABLED = process.env.NCURATOR_AI_LIVE_PROGRESS === '1'

const LIVE_RATE_LIMIT_ROOT_DIR = path.join(os.tmpdir(), 'ncurator-human-live-rate-limit')
const DEFAULT_LIVE_MIN_INTERVAL_MS = 20_000
const DEFAULT_LIVE_MAX_RETRIES = 2
const DEFAULT_LIVE_RETRY_BASE_MS = 15_000
const DEFAULT_LIVE_RETRY_MAX_MS = 90_000
const DEFAULT_LIVE_STALE_LOCK_MS = 10 * 60_000
const DEFAULT_LIVE_LEASE_HEARTBEAT_MS = 5_000
const DEFAULT_LIVE_LOCK_WAIT_TIMEOUT_MS = 60_000

type LiveRateLimitChannelState = {
  lastStartedAt: number
}

type LiveRateLimitLease = {
  ownerId: string
  pid: number
  acquiredAt: number
  heartbeatAt: number
  modelName: string
  baseUrl: string
}

type LiveRateLimitControlConfig = {
  minIntervalMs: number
  maxRetries: number
  retryBaseMs: number
  retryMaxMs: number
  staleLockMs: number
  leaseHeartbeatMs: number
  lockWaitTimeoutMs: number
}

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const readPositiveEnvNumber = (name: string): number | undefined => {
  const value = Number(process.env[name] || '')
  return Number.isFinite(value) && value > 0 ? value : undefined
}

const hashLiveRateLimitChannel = (config: LiveLlmConfig): string =>
  createHash('sha1')
    .update(`${config.base_url}\n${config.api_key}`)
    .digest('hex')

const resolveLiveRateLimitChannelPaths = (config: LiveLlmConfig) => {
  const channelId = hashLiveRateLimitChannel(config)
  const channelDir = path.join(LIVE_RATE_LIMIT_ROOT_DIR, channelId)
  return {
    channelDir,
    leaseFile: path.join(channelDir, 'lease.json'),
    stateFile: path.join(channelDir, 'state.json')
  }
}

const readLiveRateLimitState = async (stateFile: string): Promise<LiveRateLimitChannelState> => {
  try {
    const raw = await fs.readFile(stateFile, 'utf8')
    const parsed = JSON.parse(raw) as { lastStartedAt?: number }
    return {
      lastStartedAt: Number(parsed.lastStartedAt || 0)
    }
  } catch {
    return {
      lastStartedAt: 0
    }
  }
}

const createLiveRateLimitLease = (config: LiveLlmConfig): LiveRateLimitLease => ({
  ownerId: randomUUID(),
  pid: process.pid,
  acquiredAt: Date.now(),
  heartbeatAt: Date.now(),
  modelName: config.model_name,
  baseUrl: config.base_url
})

const readLiveRateLimitLease = async (leaseFile: string): Promise<LiveRateLimitLease | null> => {
  try {
    const raw = await fs.readFile(leaseFile, 'utf8')
    const parsed = JSON.parse(raw) as Partial<LiveRateLimitLease>
    if (
      typeof parsed.ownerId !== 'string' ||
      !parsed.ownerId.trim() ||
      !Number.isFinite(parsed.acquiredAt) ||
      !Number.isFinite(parsed.heartbeatAt)
    ) {
      return null
    }
    return {
      ownerId: parsed.ownerId,
      pid: Number(parsed.pid || 0),
      acquiredAt: Number(parsed.acquiredAt),
      heartbeatAt: Number(parsed.heartbeatAt),
      modelName: String(parsed.modelName || ''),
      baseUrl: String(parsed.baseUrl || '')
    }
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (code === 'ENOENT') {
      return null
    }
    throw error
  }
}

const writeLiveRateLimitLease = async (
  leaseFile: string,
  lease: LiveRateLimitLease,
  flag?: 'wx'
): Promise<void> => {
  await fs.writeFile(leaseFile, JSON.stringify(lease), {
    encoding: 'utf8',
    flag
  })
}

const isLiveRateLimitLeaseStale = (
  lease: LiveRateLimitLease | null,
  staleLockMs: number
): boolean => {
  if (!lease) return true
  return Date.now() - lease.heartbeatAt >= staleLockMs
}

const cleanupStaleLiveRateLimitLease = async (leaseFile: string): Promise<boolean> => {
  try {
    await fs.unlink(leaseFile)
    return true
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (code === 'ENOENT') {
      return true
    }
    if (code === 'ENOTEMPTY' || code === 'EEXIST') {
      return false
    }
    throw error
  }
}

const cleanupLegacyDirectoryLocks = async (channelDir: string, staleLockMs: number): Promise<void> => {
  const legacyLockDirs = [path.join(LIVE_RATE_LIMIT_ROOT_DIR, 'lock'), path.join(channelDir, 'lock')]
  await Promise.all(
    legacyLockDirs.map(async (legacyLockDir) => {
      try {
        const stat = await fs.stat(legacyLockDir)
        if (!stat.isDirectory() || Date.now() - stat.mtimeMs < staleLockMs) {
          return
        }
        await fs.rmdir(legacyLockDir)
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][rate-limit-lock] cleaned legacy lock dir ${legacyLockDir}`
          )
        }
      } catch (error) {
        const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
        if (code !== 'ENOENT' && code !== 'ENOTEMPTY') {
          throw error
        }
      }
    })
  )
}

const startLiveRateLimitLeaseHeartbeat = (
  leaseFile: string,
  lease: LiveRateLimitLease,
  control: LiveRateLimitControlConfig
): (() => void) => {
  let stopped = false
  const timer = setInterval(() => {
    if (stopped) return
    lease.heartbeatAt = Date.now()
    void writeLiveRateLimitLease(leaseFile, lease).catch((error) => {
      if (LIVE_PROGRESS_DEBUG_ENABLED) {
        console.error(
          `[live-progress][rate-limit-lock] heartbeat write failed; leaseFile=${leaseFile}; error=${getLiveRateLimitErrorText(error)}`
        )
      }
    })
  }, control.leaseHeartbeatMs)

  return () => {
    stopped = true
    clearInterval(timer)
  }
}

const releaseLiveRateLimitLease = async (
  leaseFile: string,
  ownerId: string
): Promise<void> => {
  try {
    const lease = await readLiveRateLimitLease(leaseFile)
    if (!lease || lease.ownerId !== ownerId) {
      return
    }
    await fs.unlink(leaseFile)
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (code !== 'ENOENT') {
      throw error
    }
  }
}

const acquireLiveRateLimitLease = async (
  channelDir: string,
  leaseFile: string,
  config: LiveLlmConfig,
  control: LiveRateLimitControlConfig
): Promise<LiveRateLimitLease> => {
  await fs.mkdir(channelDir, { recursive: true })
  await cleanupLegacyDirectoryLocks(channelDir, control.staleLockMs)
  const startedAt = Date.now()

  while (true) {
    const lease = createLiveRateLimitLease(config)
    try {
      await writeLiveRateLimitLease(leaseFile, lease, 'wx')
      return lease
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
      if (code !== 'EEXIST') {
        throw error
      }
      const existingLease = await readLiveRateLimitLease(leaseFile)
      const stale = isLiveRateLimitLeaseStale(existingLease, control.staleLockMs)
      if (stale) {
        const cleaned = await cleanupStaleLiveRateLimitLease(leaseFile)
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][rate-limit-lock] stale lease detected at ${leaseFile}; cleaned=${cleaned}`
          )
        }
        if (cleaned) {
          continue
        }
      }
      if (Date.now() - startedAt >= control.lockWaitTimeoutMs) {
        throw new Error(
          `live_rate_limit_lock_timeout; waitedMs=${Date.now() - startedAt}; leaseFile=${leaseFile}; owner=${existingLease?.ownerId || 'unknown'}; model=${existingLease?.modelName || 'unknown'}`
        )
      }
      await sleep(200)
    }
  }
}

const resolveLiveRateLimitControlConfig = (): LiveRateLimitControlConfig => {
  return {
    minIntervalMs:
      readPositiveEnvNumber('NCURATOR_AI_LIVE_MIN_INTERVAL_MS') || DEFAULT_LIVE_MIN_INTERVAL_MS,
    maxRetries: DEFAULT_LIVE_MAX_RETRIES,
    retryBaseMs: DEFAULT_LIVE_RETRY_BASE_MS,
    retryMaxMs: DEFAULT_LIVE_RETRY_MAX_MS,
    staleLockMs:
      readPositiveEnvNumber('NCURATOR_AI_LIVE_STALE_LOCK_MS') || DEFAULT_LIVE_STALE_LOCK_MS,
    leaseHeartbeatMs:
      readPositiveEnvNumber('NCURATOR_AI_LIVE_LEASE_HEARTBEAT_MS') ||
      DEFAULT_LIVE_LEASE_HEARTBEAT_MS,
    lockWaitTimeoutMs:
      readPositiveEnvNumber('NCURATOR_AI_LIVE_LOCK_WAIT_TIMEOUT_MS') ||
      DEFAULT_LIVE_LOCK_WAIT_TIMEOUT_MS
  }
}

const getLiveRateLimitErrorText = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return String(error || '')
}

const isLiveRateLimitError = (error: unknown): boolean =>
  /(?:^|[^a-z])429(?:[^a-z]|$)|MODEL_RATE_LIMIT|rate limit|请求数限制|too many requests/i.test(
    getLiveRateLimitErrorText(error)
  )

const parseRetryAfterMs = (error: unknown): number | undefined => {
  const message = getLiveRateLimitErrorText(error)
  const secondsMatch =
    /retry-after[:=\s]+(\d+(?:\.\d+)?)s\b/i.exec(message) ||
    /retry after[:=\s]+(\d+(?:\.\d+)?)s\b/i.exec(message)
  if (secondsMatch) {
    const seconds = Number(secondsMatch[1])
    return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : undefined
  }

  const msMatch =
    /retry-after[:=\s]+(\d+)\s*ms\b/i.exec(message) ||
    /retry after[:=\s]+(\d+)\s*ms\b/i.exec(message)
  if (msMatch) {
    const ms = Number(msMatch[1])
    return Number.isFinite(ms) && ms > 0 ? ms : undefined
  }

  return undefined
}

const computeRetryDelayMs = (
  error: unknown,
  attemptIndex: number,
  control: LiveRateLimitControlConfig
): number => {
  const retryAfterMs = parseRetryAfterMs(error)
  if (retryAfterMs) {
    return Math.min(control.retryMaxMs, retryAfterMs)
  }

  const exponentialDelayMs = Math.min(
    control.retryMaxMs,
    control.retryBaseMs * 2 ** Math.max(0, attemptIndex)
  )
  const jitterMs = Math.min(1_500, control.retryBaseMs)
  return exponentialDelayMs + Math.floor(Math.random() * jitterMs)
}

const invokeLiveStructuredChatWithRateLimitControl = async <T extends Record<string, unknown>>(input: {
  config: LiveLlmConfig
  payload: Parameters<NonNullable<CreateAiRunContextInput['chatStructuredOverride']>>[0]
}): Promise<T> => {
  const control = resolveLiveRateLimitControlConfig()
  const channelPaths = resolveLiveRateLimitChannelPaths(input.config)
  const lease = await acquireLiveRateLimitLease(
    channelPaths.channelDir,
    channelPaths.leaseFile,
    input.config,
    control
  )
  const stopLeaseHeartbeat = startLiveRateLimitLeaseHeartbeat(
    channelPaths.leaseFile,
    lease,
    control
  )

  try {
    for (let attemptIndex = 0; attemptIndex <= control.maxRetries; attemptIndex += 1) {
      const state = await readLiveRateLimitState(channelPaths.stateFile)
      const now = Date.now()
      const waitMs = Math.max(0, state.lastStartedAt + control.minIntervalMs - now)
      if (waitMs > 0) {
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][llm] waiting ${waitMs}ms before request; model=${input.config.model_name}; attempt=${attemptIndex + 1}`
          )
        }
        await sleep(waitMs)
      }

      await fs.writeFile(
        channelPaths.stateFile,
        JSON.stringify({
          lastStartedAt: Date.now()
        }),
        'utf8'
      )

      try {
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][llm] invoke start; caller=${input.payload.caller}; schema=${input.payload.schemaName}; model=${input.config.model_name}; baseUrl=${input.config.base_url}; attempt=${attemptIndex + 1}`
          )
        }
        const result = (await invokeStructuredChat({
          caller: input.payload.caller,
          cfg: input.config,
          schema: input.payload.schema,
          schemaName: input.payload.schemaName,
          system: input.payload.system,
          user: input.payload.user,
          temperature: input.payload.temperature
        })) as T
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][llm] invoke success; caller=${input.payload.caller}; schema=${input.payload.schemaName}; model=${input.config.model_name}; attempt=${attemptIndex + 1}`
          )
        }
        return result
      } catch (error) {
        if (LIVE_PROGRESS_DEBUG_ENABLED) {
          console.error(
            `[live-progress][llm] invoke error; caller=${input.payload.caller}; schema=${input.payload.schemaName}; model=${input.config.model_name}; attempt=${attemptIndex + 1}; error=${getLiveRateLimitErrorText(error)}`
          )
        }
        if (!isLiveRateLimitError(error) || attemptIndex >= control.maxRetries) {
          throw error
        }

        await sleep(computeRetryDelayMs(error, attemptIndex, control))
      }
    }

    throw new Error('unreachable live rate limit retry state')
  } finally {
    stopLeaseHeartbeat()
    await releaseLiveRateLimitLease(channelPaths.leaseFile, lease.ownerId)
  }
}

export type HumanLiveKbFixture = {
  selectedDocumentIds: string[]
  documents: DocumentRecord[]
  rows: SearchResult[]
  storeOverrides: TestDocumentsStoreOverrides
}

export const createHumanLiveKbSelectedReferences = (
  workspaceRoot: string
): SelectedReference[] => [
  {
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: 'node-doc-1',
    name: 'Risk Playbook.md',
    relativePath: 'kb/Risk Playbook.md',
    absolutePath: path.join(workspaceRoot, 'kb', 'Risk Playbook.md'),
    fileExt: 'md',
    kbDocumentIds: ['doc-1'],
    kbAvailability: 'indexed'
  },
  {
    kind: 'file',
    workspaceId: 'test-workspace',
    nodeId: 'node-doc-2',
    name: 'Owner Notes.md',
    relativePath: 'kb/Owner Notes.md',
    absolutePath: path.join(workspaceRoot, 'kb', 'Owner Notes.md'),
    fileExt: 'md',
    kbDocumentIds: ['doc-2'],
    kbAvailability: 'indexed'
  }
]

const filterRowsByDocumentIds = (
  rows: readonly SearchResult[],
  scopedDocumentIds: readonly string[] | undefined
): SearchResult[] => {
  if (!Array.isArray(scopedDocumentIds) || scopedDocumentIds.length === 0) {
    return [...rows]
  }

  const allowed = new Set(scopedDocumentIds)
  return rows.filter((row) => row.document_id && allowed.has(row.document_id))
}

export const createHumanLiveKbFixture = (): HumanLiveKbFixture => {
  const documents = [
    createTestDocumentRecord({
      id: 'doc-1',
      name: 'Risk Playbook.md'
    }),
    createTestDocumentRecord({
      id: 'doc-2',
      name: 'Owner Notes.md'
    }),
    createTestDocumentRecord({
      id: 'doc-3',
      name: 'Out of Scope Notes.md'
    })
  ]

  const rows = [
    createTestSearchResult({
      id: 'chunk-1',
      text: 'Weekly risk summary should stay marked as pending follow-up until compliance signs off.',
      documentId: 'doc-1',
      documentName: 'Risk Playbook.md'
    }),
    createTestSearchResult({
      id: 'chunk-2',
      text: 'Owner note should mention that Compliance leads the final review window.',
      documentId: 'doc-2',
      documentName: 'Owner Notes.md'
    }),
    createTestSearchResult({
      id: 'chunk-3',
      text: 'This out-of-scope note must never appear in the final scoped result.',
      documentId: 'doc-3',
      documentName: 'Out of Scope Notes.md'
    })
  ]

  const search = async (
    scopedDocumentIds: readonly string[] | undefined
  ): Promise<SearchResult[]> => filterRowsByDocumentIds(rows, scopedDocumentIds)

  return {
    selectedDocumentIds: ['doc-1', 'doc-2'],
    documents,
    rows,
    storeOverrides: {
      listDocuments: async () => ({
        items: documents,
        total: documents.length
      }),
      hybridSearch: async (_vec, _queryText, _limit, _sourceType, scopedDocumentIds) =>
        await search(scopedDocumentIds),
      vectorSearch: async (_vec, _limit, _sourceType, scopedDocumentIds) =>
        await search(scopedDocumentIds),
      ftsSearch: async (_queryText, _limit, _sourceType, scopedDocumentIds) =>
        await search(scopedDocumentIds)
    }
  }
}

export const filterToolCallResultEventsByNames = (
  events: readonly AiRunEvent[],
  toolNames: readonly string[]
): Extract<AiRunEvent, { type: 'tool_call_result' }>[] => {
  const expectedNames = new Set(toolNames)
  return filterAiRunEventsByType(events, 'tool_call_result').filter((event) =>
    expectedNames.has(event.toolName)
  )
}

export const collectToolResultPreviewText = (
  events: readonly AiRunEvent[],
  toolNames: readonly string[]
): string =>
  filterToolCallResultEventsByNames(events, toolNames)
    .map((event) => JSON.stringify(event.outputPreview))
    .join('\n')

export const filterHumanStepsByStage = (
  events: readonly AiRunEvent[],
  stage: Extract<
    NonNullable<AiRunEvent['stage']>,
    'human_brain' | 'human_hand' | 'human_learning' | 'human_mouth'
  >
): Extract<AiRunEvent, { type: 'human_step' }>[] =>
  filterAiRunEventsByType(events, 'human_step').filter((event) => event.stage === stage)

export const isFileArtifact = (
  artifact: AiArtifactRef
): artifact is Extract<AiArtifactRef, { kind: 'file' }> => artifact.kind === 'file'

export const isDocxPreviewArtifact = (
  artifact: AiArtifactRef
): artifact is Extract<AiArtifactRef, { kind: 'file' }> =>
  isFileArtifact(artifact) && artifact.capability === 'docx' && artifact.artifactRole === 'preview'

export const areAllPathsAccessible = async (paths: readonly string[]): Promise<boolean> => {
  if (paths.length === 0) {
    return false
  }

  const results = await Promise.all(
    paths.map(async (filePath) => {
      try {
        await fs.access(filePath)
        return true
      } catch {
        return false
      }
    })
  )

  return results.every((result) => result)
}

const summarizeLiveProgressEvent = (event: AiRunEvent | undefined): string => {
  if (!event) {
    return 'no-events-yet'
  }

  if (event.type === 'human_step') {
    return `${event.stage}:${event.action}:${event.summary}`
  }

  if (event.type === 'tool_call_started') {
    return `tool_started:${event.toolName}`
  }

  if (event.type === 'tool_call_result') {
    return `tool_result:${event.toolName}`
  }

  if (event.type === 'watch_hint') {
    return `watch_hint:${event.summary}`
  }

  if (event.type === 'task_delivery_ready') {
    return `delivery:${event.summary}`
  }

  if (event.type === 'approval_required') {
    return `approval_required:${event.command}`
  }

  if (event.type === 'approval_decision') {
    return `approval_decision:${event.approved ? 'approved' : 'denied'}`
  }

  if (event.type === 'file_artifact') {
    return `artifact:${event.artifactRole}:${event.fileName}`
  }

  if (event.type === 'activity') {
    return `activity:${event.actionType}:${event.status}`
  }

  return event.type
}

export const startLiveProgressLogger = (input: {
  caseId: string
  snapshot: () => AiRunEvent[]
  intervalMs?: number
}): (() => void) => {
  if (!LIVE_PROGRESS_DEBUG_ENABLED) {
    return () => undefined
  }

  const timer = setInterval(() => {
    const events = input.snapshot()
    const lastEvent = events.at(-1)
    const secondLastEvent = events.at(-2)
    console.error(
      `[live-progress][${input.caseId}] events=${events.length} last=${summarizeLiveProgressEvent(lastEvent)} prev=${summarizeLiveProgressEvent(secondLastEvent)}`
    )
  }, input.intervalMs ?? 20_000)

  return () => {
    clearInterval(timer)
  }
}

export const createRateLimitedLiveChatStructuredOverride = (
  config: LiveLlmConfig
): NonNullable<CreateAiRunContextInput['chatStructuredOverride']> => {
  return async <T extends Record<string, unknown>>(input) => {
    return await invokeLiveStructuredChatWithRateLimitControl<T>({
      config,
      payload: input
    })
  }
}
