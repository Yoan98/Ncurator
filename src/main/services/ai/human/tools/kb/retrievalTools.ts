import { tool } from '@langchain/core/tools'
import type {
  AiToolCallResult,
  DocumentRecord,
  JsonObject,
  JsonValue,
  SearchResult
} from '../../../../../../shared/types'
import type { KnowledgeRetrievalContext } from '../../../types'
import { normalizeForIpc } from '../../../../../utils/serialization'
import { KB_LIST_DOCUMENTS_TOOL_SPEC, KB_SEARCH_TOOL_SPEC } from './toolSpecs'
import { withToolLifecycle } from '../utils/lifecycle'
import { createToolEventEmitter } from '../utils/toolEvents'

const MAX_RETRIEVAL_LIMIT = 50
const MAX_LIST_PAGE_SIZE = 50

const toStringIdList = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item).trim()).filter(Boolean)
}

const buildKbResult = (input: {
  toolName: string
  data: unknown
  ok?: boolean
  error?: string
}): AiToolCallResult => {
  const data = (() => {
    try {
      return JSON.parse(JSON.stringify(input.data)) as JsonValue
    } catch {
      return undefined
    }
  })()

  const normalizedData =
    input.ok === false && input.error
      ? {
          ...(data && typeof data === 'object' && !Array.isArray(data) ? data : {}),
          error: input.error
        }
      : data

  return {
    toolName: input.toolName,
    ok: input.ok ?? true,
    data: normalizedData
  }
}

const resolveRequestedDocumentIds = (requestedIds: string[] | undefined): string[] | null => {
  if (!Array.isArray(requestedIds)) return null
  return toStringIdList(requestedIds)
}

const assertDocumentHasSourceLocation = (document: DocumentRecord): void => {
  if (document.source_type === 'file' && !document.file_path?.trim()) {
    throw new Error(`KB document is missing file_path: ${document.name} (${document.id})`)
  }
  if (document.source_type === 'web' && !document.source_url?.trim()) {
    throw new Error(`KB web document is missing source_url: ${document.name} (${document.id})`)
  }
}

const enrichSearchRowsWithSourceLocation = async (
  ctx: KnowledgeRetrievalContext,
  rows: SearchResult[]
): Promise<SearchResult[]> => {
  const documentIds = Array.from(
    new Set(rows.map((row) => String(row.document_id || '').trim()).filter(Boolean))
  )
  if (documentIds.length === 0) return rows

  const documents = await ctx.documentsStore.listDocuments({
    page: 1,
    pageSize: Math.min(MAX_LIST_PAGE_SIZE, documentIds.length),
    workspaceId: String(ctx.workspace?.workspaceId || '').trim() || undefined,
    documentIds
  })
  const documentMap = new Map(documents.items.map((document) => [document.id, document] as const))

  return rows.map((row) => {
    const document = row.document_id ? documentMap.get(row.document_id) : undefined
    if (!document) {
      throw new Error(`KB search result is missing source document metadata: ${row.document_id}`)
    }
    assertDocumentHasSourceLocation(document)

    return {
      ...row,
      source_type: document.source_type || row.source_type,
      file_path: document.source_type === 'file' ? document.file_path : undefined,
      source_url: document.source_type === 'web' ? document.source_url : undefined
    }
  })
}

const validateDocumentListSourceLocations = <T extends { items: DocumentRecord[] }>(
  response: T
): T => {
  response.items.forEach(assertDocumentHasSourceLocation)
  return response
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
    strategy?: 'auto' | 'semantic' | 'keyword'
    limit?: number
    sourceType?: 'all' | 'file' | 'web'
    documentIds?: string[]
  }) => ({
    workspaceId: String(ctx.workspace?.workspaceId || '').trim() || undefined,
    queryText: String(args.queryText || '').trim(),
    strategy: args.strategy || 'auto',
    limit: Math.max(1, Math.min(MAX_RETRIEVAL_LIMIT, Number(args.limit ?? 10))),
    filter: args.sourceType && args.sourceType !== 'all' ? String(args.sourceType) : undefined,
    requestedDocumentIds: resolveRequestedDocumentIds(args.documentIds)
  })

  const kbSearch = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: KB_SEARCH_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async (session) => {
          ctx.checkCancelled()
          const prepared = resolveSearchArgs(args)
          if (!prepared.workspaceId) {
            throw new Error('workspace is required for kb search')
          }
          if (
            Array.isArray(prepared.requestedDocumentIds) &&
            prepared.requestedDocumentIds.length === 0
          ) {
            const empty = { items: [] as SearchResult[], total: 0 }
            session.succeed(
              undefined,
              buildKbResult({
                toolName: KB_SEARCH_TOOL_SPEC.name,
                data: empty
              })
            )
            return empty
          }

          const rows = await (async () => {
            if (prepared.strategy === 'keyword') {
              return await ctx.documentsStore.ftsSearch(
                prepared.queryText,
                prepared.limit,
                prepared.filter,
                prepared.workspaceId,
                prepared.requestedDocumentIds || undefined
              )
            }
            let vec: Float32Array
            try {
              const embedding = await ctx.embeddingService.embed(prepared.queryText)
              vec = embedding.data
            } catch (error) {
              if (prepared.strategy !== 'auto') throw error
              return await ctx.documentsStore.ftsSearch(
                prepared.queryText,
                prepared.limit,
                prepared.filter,
                prepared.workspaceId,
                prepared.requestedDocumentIds || undefined
              )
            }
            if (prepared.strategy === 'semantic') {
              return await ctx.documentsStore.vectorSearch(
                vec,
                prepared.limit,
                prepared.filter,
                prepared.workspaceId,
                prepared.requestedDocumentIds || undefined
              )
            }
            return await ctx.documentsStore.hybridSearch(
              vec,
              prepared.queryText,
              prepared.limit,
              prepared.filter,
              prepared.workspaceId,
              prepared.requestedDocumentIds || undefined
            )
          })()
          const enrichedRows = await enrichSearchRowsWithSourceLocation(ctx, rows)
          const normalized = enrichedRows.map(normalizeForIpc)
          const payload = {
            items: normalized,
            total: normalized.length
          }
          session.succeed(
            undefined,
            buildKbResult({
              toolName: KB_SEARCH_TOOL_SPEC.name,
              data: payload
            })
          )
          return payload
        },
        onError: (error, session) => {
          session.fail(
            error.message,
            undefined,
            buildKbResult({
              toolName: KB_SEARCH_TOOL_SPEC.name,
              ok: false,
              data: {
                items: [],
                total: 0
              },
              error: error.message
            })
          )
        }
      }),
    {
      name: KB_SEARCH_TOOL_SPEC.name,
      description: KB_SEARCH_TOOL_SPEC.promptSpec.description,
      schema: KB_SEARCH_TOOL_SPEC.inputSchema
    }
  )

  const kbListDocuments = tool(
    async (args) =>
      await withToolLifecycle({
        emitter: toolEvents,
        toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
        args: args as JsonObject,
        execute: async (session) => {
          ctx.checkCancelled()
          const workspaceId = String(ctx.workspace?.workspaceId || '').trim() || undefined
          if (!workspaceId) {
            throw new Error('workspace is required for kb search')
          }
          const sourceNameQuery = String(args.sourceNameQuery || '').trim() || undefined
          const page = Math.max(1, Number(args.page ?? 1))
          const pageSize = Math.max(1, Math.min(MAX_LIST_PAGE_SIZE, Number(args.pageSize ?? 20)))
          const requestedDocumentIds = resolveRequestedDocumentIds(args.documentIds)

          if (Array.isArray(requestedDocumentIds) && requestedDocumentIds.length === 0) {
            const empty = { items: [], total: 0 }
            session.succeed(
              undefined,
              buildKbResult({
                toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
                data: empty
              })
            )
            return empty
          }

          const normalized = validateDocumentListSourceLocations(
            await ctx.documentsStore.listDocuments({
              sourceNameQuery,
              page,
              pageSize,
              workspaceId,
              documentIds: requestedDocumentIds || undefined
            })
          )
          session.succeed(
            undefined,
            buildKbResult({
              toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
              data: normalized
            })
          )
          return normalized
        },
        onError: (error, session) => {
          session.fail(
            error.message,
            undefined,
            buildKbResult({
              toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
              ok: false,
              data: {
                items: [],
                total: 0
              },
              error: error.message
            })
          )
        }
      }),
    {
      name: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
      description: KB_LIST_DOCUMENTS_TOOL_SPEC.promptSpec.description,
      schema: KB_LIST_DOCUMENTS_TOOL_SPEC.inputSchema
    }
  )

  return [kbSearch, kbListDocuments]
}
