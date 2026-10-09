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

export const KB_INDEXING_IN_PROGRESS_ERROR = '正在更新知识库索引，请完成后再检索。'
const MAX_RETRIEVAL_LIMIT = 50
const MAX_LIST_PAGE_SIZE = 50

const mapKbSearchItem = (row: SearchResult) => ({
  id: row.id,
  text: row.text,
  documentName: row.document_name,
  documentId: row.document_id,
  sourceType: row.source_type,
  filePath: row.file_path,
  sourceUrl: row.source_url,
  metadata: row.metadata,
  createdAt: row.created_at
})

const mapKbDocumentItem = (document: DocumentRecord) => ({
  id: document.id,
  name: document.name,
  sourceType: document.source_type,
  workspaceId: document.workspace_id,
  filePath: document.file_path,
  createdAt: document.created_at,
  importStatus: document.import_status,
  sourceId: document.source_id,
  sourceUrl: document.source_url,
  sourceTitle: document.source_title,
  normalizedSourceUrl: document.normalized_source_url,
  fetchedAt: document.fetched_at,
  updatedAt: document.updated_at,
  lastError: document.last_error
})

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
    input.ok === false && input.error ? ({ error: input.error } satisfies JsonObject) : data

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
    throw new Error(`知识库文档缺少本地文件路径：${document.name} (${document.id})`)
  }
  if (document.source_type === 'web' && !document.source_url?.trim()) {
    throw new Error(`知识库网页文档缺少来源地址：${document.name} (${document.id})`)
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
      throw new Error(`知识库搜索结果缺少来源文档元数据：${row.document_id}`)
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
          await ctx.assertKbAvailable()
          const prepared = resolveSearchArgs(args)
          if (!prepared.queryText) {
            throw new Error('知识库搜索需要提供查询文本。')
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
            const { data: vec } = await ctx.embeddingService.embed(prepared.queryText)
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
          const normalized = enrichedRows.map((row) => normalizeForIpc(mapKbSearchItem(row)))
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
          await ctx.assertKbAvailable()
          const workspaceId = String(ctx.workspace?.workspaceId || '').trim() || undefined
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
          const payload = {
            items: normalized.items.map((document) => mapKbDocumentItem(document)),
            total: normalized.total
          }
          session.succeed(
            undefined,
            buildKbResult({
              toolName: KB_LIST_DOCUMENTS_TOOL_SPEC.name,
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
