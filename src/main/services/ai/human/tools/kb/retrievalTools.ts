import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { SearchResult } from '../../../../../../shared/types'
import type { KnowledgeRetrievalContext } from '../../../types'
import { normalizeForIpc } from '../../../../../utils/serialization'
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

export const buildRetrievalTools = (input: {
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
    name: 'kb_hybrid_search_chunks' | 'kb_vector_search_chunks' | 'kb_fts_search_chunks'
    description: string
    execute: (args: ReturnType<typeof resolveSearchArgs>) => Promise<SearchResult[]>
  }) =>
    tool(
      async (args) => {
        const toolCallId = toolEvents.emitStarted(input.name, args)
        try {
          ctx.checkCancelled()
          const prepared = resolveSearchArgs(args)
          if (Array.isArray(prepared.scopedDocumentIds) && prepared.scopedDocumentIds.length === 0) {
            toolEvents.emitResult({
              toolName: input.name,
              toolCallId,
              outputPreview: []
            })
            return []
          }

          const rows = await input.execute(prepared)
          const normalized = rows.map(normalizeForIpc)
          toolEvents.emitResult({
            toolName: input.name,
            toolCallId,
            outputPreview: previewArray(normalized)
          })
          return normalized
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          toolEvents.emitResult({
            toolName: input.name,
            toolCallId,
            outputPreview: [],
            error: msg
          })
          throw error
        }
      },
      {
        name: input.name,
        description: input.description,
        schema: z.object({
          queryText: z.string(),
          limit: z.number().optional(),
          sourceType: z.enum(['all', 'file', 'web']).optional(),
          documentIds: z.array(z.string()).optional()
        })
      }
    )

  const kbHybridSearchChunks = createChunkSearchTool({
    name: 'kb_hybrid_search_chunks',
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
    name: 'kb_vector_search_chunks',
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
    name: 'kb_fts_search_chunks',
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
    async (args) => {
      const toolName = 'kb_list_documents'
      const toolCallId = toolEvents.emitStarted(toolName, args)
      try {
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
          toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: []
          })
          return empty
        }

        const res = await ctx.documentsStore.listDocuments({ keyword, page, pageSize })
        if (!scopedDocumentIds) {
          toolEvents.emitResult({
            toolName,
            toolCallId,
            outputPreview: previewArray(res.items)
          })
          return res
        }

        const allowed = new Set(scopedDocumentIds)
        const items = res.items.filter((item) => allowed.has(item.id))
        const normalized = { items, total: items.length }
        toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: previewArray(items)
        })
        return normalized
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        toolEvents.emitResult({
          toolName,
          toolCallId,
          outputPreview: { items: [], total: 0 },
          error: msg
        })
        throw error
      }
    },
    {
      name: 'kb_list_documents',
      description: 'List local knowledge base documents by keyword (document table).',
      schema: z.object({
        keyword: z.string().optional(),
        page: z.number().optional(),
        pageSize: z.number().optional(),
        documentIds: z.array(z.string()).optional()
      })
    }
  )

  return [kbHybridSearchChunks, kbVectorSearchChunks, kbFtsSearchChunks, kbListDocuments]
}
