import { tool } from '@langchain/core/tools'
import type {
  AiToolCallResult,
  JsonObject,
  JsonValue,
  SearchResult
} from '../../../../../../shared/types'
import type { KnowledgeRetrievalContext } from '../../../types'
import { normalizeForIpc } from '../../../../../utils/serialization'
import {
  KB_LIST_DOCUMENTS_TOOL_SPEC,
  KB_SEARCH_TOOL_SPEC
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

const buildKbResult = (input: {
  toolName: string
  data: unknown
  ok?: boolean
  code?: AiToolCallResult['code']
}): AiToolCallResult => {
  const data = (() => {
    try {
      return JSON.parse(JSON.stringify(input.data)) as JsonValue
    } catch {
      return undefined
    }
  })()

  return {
    toolName: input.toolName,
    ok: input.ok ?? true,
    code: input.code || (input.ok === false ? 'failed' : 'ok'),
    data,
    diagnostic: undefined
  }
}

const resolveRequestedDocumentIds = (requestedIds: string[] | undefined): string[] | null => {
  if (!Array.isArray(requestedIds)) return null
  return toStringIdList(requestedIds)
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
            const emptyRows: SearchResult[] = []
            session.succeed(
              undefined,
              buildKbResult({
                toolName: KB_SEARCH_TOOL_SPEC.name,
                data: emptyRows
              })
            )
            return []
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
          const normalized = rows.map(normalizeForIpc)
          session.succeed(
            undefined,
            buildKbResult({
              toolName: KB_SEARCH_TOOL_SPEC.name,
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
              toolName: KB_SEARCH_TOOL_SPEC.name,
              ok: false,
              code: 'failed',
              data: {
                items: [],
                total: 0,
                error: error.message
              }
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

          const normalized = await ctx.documentsStore.listDocuments({
            sourceNameQuery,
            page,
            pageSize,
            workspaceId,
            documentIds: requestedDocumentIds || undefined
          })
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
              code: 'failed',
              data: {
                items: [],
                total: 0,
                error: error.message
              }
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
