import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AiArtifactRef,
  AiRunEvent,
  DocumentRecord,
  SearchResult
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

const LIVE_RATE_LIMIT_DIR = path.join(os.tmpdir(), 'ncurator-human-live-rate-limit')
const LIVE_RATE_LIMIT_LOCK_DIR = path.join(LIVE_RATE_LIMIT_DIR, 'lock')
const LIVE_RATE_LIMIT_STATE_FILE = path.join(LIVE_RATE_LIMIT_DIR, 'state.json')

const sleep = async (ms: number): Promise<void> =>
  await new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

const readLiveRateLimitState = async (): Promise<{ lastStartedAt: number }> => {
  try {
    const raw = await fs.readFile(LIVE_RATE_LIMIT_STATE_FILE, 'utf8')
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

const acquireLiveRateLimitLock = async (): Promise<void> => {
  await fs.mkdir(LIVE_RATE_LIMIT_DIR, { recursive: true })

  while (true) {
    try {
      await fs.mkdir(LIVE_RATE_LIMIT_LOCK_DIR)
      return
    } catch (error) {
      const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
      if (code !== 'EEXIST') {
        throw error
      }
      await sleep(200)
    }
  }
}

const releaseLiveRateLimitLock = async (): Promise<void> => {
  try {
    await fs.rmdir(LIVE_RATE_LIMIT_LOCK_DIR)
  } catch (error) {
    const code = error instanceof Error ? (error as Error & { code?: string }).code : undefined
    if (code !== 'ENOENT') {
      throw error
    }
  }
}

const awaitLiveRateLimitWindow = async (minIntervalMs: number): Promise<void> => {
  await acquireLiveRateLimitLock()

  try {
    const state = await readLiveRateLimitState()
    const now = Date.now()
    const waitMs = Math.max(0, state.lastStartedAt + minIntervalMs - now)
    if (waitMs > 0) {
      await sleep(waitMs)
    }

    await fs.writeFile(
      LIVE_RATE_LIMIT_STATE_FILE,
      JSON.stringify({
        lastStartedAt: Date.now()
      }),
      'utf8'
    )
  } finally {
    await releaseLiveRateLimitLock()
  }
}

export type HumanLiveKbFixture = {
  selectedDocumentIds: string[]
  documents: DocumentRecord[]
  rows: SearchResult[]
  storeOverrides: TestDocumentsStoreOverrides
}

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
  stage: Extract<NonNullable<AiRunEvent['stage']>, 'human_brain' | 'human_hand' | 'human_learning' | 'human_mouth'>
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

export const createRateLimitedLiveChatStructuredOverride = (
  config: LiveLlmConfig,
  minIntervalMs = 13_000
): NonNullable<CreateAiRunContextInput['chatStructuredOverride']> => {
  return async <T extends Record<string, unknown>>(input) => {
    await awaitLiveRateLimitWindow(minIntervalMs)
    return await invokeStructuredChat({
      caller: input.caller,
      cfg: config,
      schema: input.schema,
      schemaName: input.schemaName,
      system: input.system,
      user: input.user,
      temperature: input.temperature
    }) as T
  }
}
