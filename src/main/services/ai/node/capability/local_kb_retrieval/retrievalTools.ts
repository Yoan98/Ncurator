import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { v4 as uuidv4 } from 'uuid'
import type { IpcJsonObject, IpcJsonValue } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { normalizeForIpc } from '../../../../../utils/serialization'

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

const resolveScopedDocumentIds = (
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
  ctx: AiRunContext
  runId: string
  taskId?: string
}) => {
  const { ctx, runId, taskId } = input

  const emitStarted = (toolName: string, args: IpcJsonObject) => {
    const toolCallId = uuidv4()
    ctx.sendEvent({
      type: 'tool_call_started',
      runId,
      taskId,
      toolCallId,
      toolName,
      input: args,
      createdAt: Date.now()
    })
    return toolCallId
  }

  const emitResult = (
    toolName: string,
    toolCallId: string,
    outputPreview: IpcJsonValue,
    error?: string
  ) => {
    ctx.sendEvent({
      type: 'tool_call_result',
      runId,
      taskId,
      toolCallId,
      toolName,
      outputPreview,
      completedAt: Date.now(),
      error
    })
  }

  const kbHybridSearchChunks = tool(
    async (args) => {
      const toolName = 'kb_hybrid_search_chunks'
      const toolCallId = emitStarted(toolName, args)
      try {
        ctx.checkCancelled()
        const queryText = String(args.queryText || '').trim()
        const limit = Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Number(args.limit ?? 10)))
        const filter =
          args.sourceType && args.sourceType !== 'all' ? String(args.sourceType) : undefined
        const scopedDocumentIds = resolveScopedDocumentIds(
          ctx.selectedDocumentIds,
          args.documentIds
        )
        if (Array.isArray(scopedDocumentIds) && scopedDocumentIds.length === 0) {
          emitResult(toolName, toolCallId, [])
          return []
        }

        const { data: vec } = await ctx.embeddingService.embed(queryText)
        const rows = await ctx.documentsStore.hybridSearch(
          vec,
          queryText,
          limit,
          filter,
          scopedDocumentIds || undefined
        )
        const normalized = rows.map(normalizeForIpc)
        emitResult(toolName, toolCallId, previewArray(normalized))
        return normalized
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emitResult(toolName, toolCallId, [], msg)
        throw e
      }
    },
    {
      name: 'kb_hybrid_search_chunks',
      description: 'Hybrid search over local knowledge base chunks (FTS + vector + RRF rerank).',
      schema: z.object({
        queryText: z.string(),
        limit: z.number().optional(),
        sourceType: z.enum(['all', 'file', 'web']).optional(),
        documentIds: z.array(z.string()).optional()
      })
    }
  )

  const kbVectorSearchChunks = tool(
    async (args) => {
      const toolName = 'kb_vector_search_chunks'
      const toolCallId = emitStarted(toolName, args)
      try {
        ctx.checkCancelled()
        const queryText = String(args.queryText || '').trim()
        const limit = Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Number(args.limit ?? 10)))
        const filter =
          args.sourceType && args.sourceType !== 'all' ? String(args.sourceType) : undefined
        const scopedDocumentIds = resolveScopedDocumentIds(
          ctx.selectedDocumentIds,
          args.documentIds
        )
        if (Array.isArray(scopedDocumentIds) && scopedDocumentIds.length === 0) {
          emitResult(toolName, toolCallId, [])
          return []
        }

        const { data: vec } = await ctx.embeddingService.embed(queryText)
        const rows = await ctx.documentsStore.vectorSearch(
          vec,
          limit,
          filter,
          scopedDocumentIds || undefined
        )
        const normalized = rows.map(normalizeForIpc)
        emitResult(toolName, toolCallId, previewArray(normalized))
        return normalized
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emitResult(toolName, toolCallId, [], msg)
        throw e
      }
    },
    {
      name: 'kb_vector_search_chunks',
      description: 'Vector-only search over local knowledge base chunks.',
      schema: z.object({
        queryText: z.string(),
        limit: z.number().optional(),
        sourceType: z.enum(['all', 'file', 'web']).optional(),
        documentIds: z.array(z.string()).optional()
      })
    }
  )

  const kbFtsSearchChunks = tool(
    async (args) => {
      const toolName = 'kb_fts_search_chunks'
      const toolCallId = emitStarted(toolName, args)
      try {
        ctx.checkCancelled()
        const queryText = String(args.queryText || '').trim()
        const limit = Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Number(args.limit ?? 10)))
        const filter =
          args.sourceType && args.sourceType !== 'all' ? String(args.sourceType) : undefined
        const scopedDocumentIds = resolveScopedDocumentIds(
          ctx.selectedDocumentIds,
          args.documentIds
        )
        if (Array.isArray(scopedDocumentIds) && scopedDocumentIds.length === 0) {
          emitResult(toolName, toolCallId, [])
          return []
        }

        const rows = await ctx.documentsStore.ftsSearch(
          queryText,
          limit,
          filter,
          scopedDocumentIds || undefined
        )
        const normalized = rows.map(normalizeForIpc)
        emitResult(toolName, toolCallId, previewArray(normalized))
        return normalized
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emitResult(toolName, toolCallId, [], msg)
        throw e
      }
    },
    {
      name: 'kb_fts_search_chunks',
      description: 'FTS-only search over local knowledge base chunks.',
      schema: z.object({
        queryText: z.string(),
        limit: z.number().optional(),
        sourceType: z.enum(['all', 'file', 'web']).optional(),
        documentIds: z.array(z.string()).optional()
      })
    }
  )

  const kbListDocuments = tool(
    async (args) => {
      const toolName = 'kb_list_documents'
      const toolCallId = emitStarted(toolName, args)
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
          emitResult(toolName, toolCallId, [])
          return empty
        }

        const res = await ctx.documentsStore.listDocuments({ keyword, page, pageSize })
        if (!scopedDocumentIds) {
          emitResult(toolName, toolCallId, previewArray(res.items))
          return res
        }

        const allowed = new Set(scopedDocumentIds)
        const items = res.items.filter((item) => allowed.has(item.id))
        const normalized = { items, total: items.length }
        emitResult(toolName, toolCallId, previewArray(items))
        return normalized
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        emitResult(toolName, toolCallId, { items: [], total: 0 }, msg)
        throw e
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
