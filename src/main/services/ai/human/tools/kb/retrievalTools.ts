import { tool } from '@langchain/core/tools'
import type { JsonObject, SearchResult } from '../../../../../../shared/types'
import type { KnowledgeRetrievalContext } from '../../../types'
import { normalizeForIpc } from '../../../../../utils/serialization'
import {
  KB_CHUNK_SEARCH_SCHEMA,
  KB_FTS_SEARCH_CHUNKS_TOOL_SPEC,
  KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC,
  KB_LIST_DOCUMENTS_TOOL_SPEC,
  KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC
} from './toolSpecs'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'

const MAX_RETRIEVAL_LIMIT = 50
const MAX_LIST_PAGE_SIZE = 50

const previewArray = <T>(rows: T[], max = 3): T[] => {
  const list = Array.isArray(rows) ? rows : []
  return list.slice(0, Math.max(0, max))
}

const toStringIdList = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

export const resolveScopedDocumentIds = (
  runScopedIds: string[] | undefined,
  requestedIds: string[] | undefined
): string[] | null => {
  const runScope = toStringIdList(runScopedIds)
  const requested = toStringIdList(requestedIds)

  if (runScope.length === 0) {
    return requested.length > 0 ? requested : null
  }

  if (requested.length === 0) return runScope

  const allowed = new Set(runScope)
  return requested.filter((id) => allowed.has(id))
}

export const buildKbCapabilityTools = (input: {
  ctx: KnowledgeRetrievalContext
  runId: string
  taskId?: string
}) => {
  const { ctx, runId, taskId } = input
  const toolEvents = createToolEventEmitter({
    ctx,
    runId,
    taskId
  })

  const resolveSearchArgs = (args: {
    queryText: string
    limit?: number
    sourceType?: 'all' | 'file' | 'web'
    documentIds?: string[]
  }) => ({
    queryText: String(args.queryText || '').trim(),
    limit: Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Number(args.limit ?? 10))),
    filter: args.sourceType && args.sourceType !== 'all' ? String(args.sourceType) : undefined,
    scopedDocumentIds: resolveScopedDocumentIds(ctx.selectedDocumentIds, args.documentIds)
  })

  const createChunkSearchTool = (input: {
    name: string
    description: string
    execute: (args: ReturnType<typeof resolveSearchArgs>) => Promise<SearchResult[]>
  }) =>
    tool(
      async (args) =>
        await withToolLifecycle({
          emitter: toolEvents,
          toolName: input.name,
          args: args as JsonObject,
          execute: async (session) => {
            ctx.checkCancelled()
            const prepared = resolveSearchArgs(args)
            if (Array.isArray(prepared.scopedDocumentIds) && prepared.scopedDocumentIds.length === 0) {
              session.succeed([])
              return []
            }

            const rows = await input.execute(prepared)
            const normalized = rows.map(normalizeForIpc)
            session.succeed(previewArray(normalized))
            return normalized
          },
          onError: (error, session) => {
            session.fail([], error.message)
          }
        }),
      {
        name: input.name,
        description: input.description,
        schema: KB_CHUNK_SEARCH_SCHEMA
      }
    )

  const kbHybridSearchChunks = createChunkSearchTool({
    name: KB_HYBRID_SEARCH_CHUNKS_TOOL_SPEC.name,
    description: 'Hybrid search over local knowledge base chunks (FTS + vector + RRF rerank).',
    execute: async (args) => {
      const { data: vec } = await ctx.embeddingService.embed(args.queryText)
      return await ctx.documentsStore.hybridSearch(
        vec,
        args.queryText,
        args.limit,
        args.filter,
        args.scopedDocumentIds || undefined
      )
    }
  })

  const kbVectorSearchChunks = createChunkSearchTool({
    name: KB_VECTOR_SEARCH_CHUNKS_TOOL_SPEC.name,
    description: 'Vector-only search over local knowledge base chunks.',
    execute: async (args) => {
      const { data: vec } = await ctx.embeddingService.embed(args.queryText)
      return await ctx.documentsStore.vectorSearch(
        vec,
        args.limit,
        args.filter,
        args.scopedDocumentIds || undefined
      )
    }
  })

  const kbFtsSearchChunks = createChunkSearchTool({
    name: KB_FTS_SEARCH_CHUNKS_TOOL_SPEC.name,
    description: 'FTS-only search over local knowledge base chunks.',
    execute: async (args) =>
      await ctx.documentsStore.ftsSearch(
        args.queryText,
        args.limit,
        args.filter,
        args.scopedDocumentIds || undefined
      )
  })

  const kbListDocuments = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async (session) => {
          ctx.checkCancelled()
          const keyword = String(args.keyword || '').trim() || undefined
          const page = Math.max(1, Number(args.page ?? 1))
          const pageSize = Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, Number(args.pageSize ?? 20)))
          const scopedDocumentIds = resolveScopedDocumentIds(
            ctx.selectedDocumentIds,
            args.documentIds
          )

          if (Array.isArray(scopedDocumentIds) && scopedDocumentIds.length === 0) {
            const empty = { items: [], total: 0 }
            session.succeed([])
            return empty
          }

          const res = await ctx.documentsStore.listDocuments({ keyword, page, pageSize })
          if (!scopedDocumentIds) {
            session.succeed(previewArray(res.items))
            return res
          }

          const allowed = new Set(scopedDocumentIds)
          const items = res.items.filter((item) => allowed.has(item.id))
          const normalized = { items, total: items.length }
          session.succeed(previewArray(items))
          return normalized
        },
        onError: (error, session) => {
          session.fail({ items: [], total: 0 }, error.message)
        }
      }),
    {
      name: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
      description: 'List local knowledge base documents by keyword (document table).',
      schema: KB_LIST_DOCUMENTS_TOOL_SPEC.schema
    }
  )

  return [kbHybridSearchChunks, kbVectorSearchChunks, kbFtsSearchChunks, kbListDocuments]
}
