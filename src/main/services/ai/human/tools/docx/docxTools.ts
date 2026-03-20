import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type {
  AiFileArtifactOperation,
  IpcJsonObject,
  IpcJsonValue
} from '../../../../../../shared/types'
import { emitFileArtifactEvent } from '../../../events/fileArtifacts'
import { resolveWorkspacePath } from '../terminal/terminalPolicy'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxChangedBlock,
  DocxOp,
  DocxOutlineBlock,
  DocxSearchMatch,
  DocxSnapshotLineageEntry,
  SemanticDocIndex,
  SemanticDocIndexEntry
} from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest } from './worker/types'

const clipText = (text: string, maxChars: number) => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}

const isSemanticSearchableBlock = (
  block: DocxOutlineBlock
): block is Extract<DocxOutlineBlock, { type: 'paragraph' | 'table_cell' }> => {
  return block.type === 'paragraph' || block.type === 'table_cell'
}

const splitEmbeddingRows = (data: Float32Array, dims: [number, number]): Float32Array[] => {
  const rowCount = Math.max(0, Number(dims[0] || 0))
  const colCount = Math.max(0, Number(dims[1] || 0))
  if (rowCount <= 0 || colCount <= 0) return []

  const rows: Float32Array[] = []
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const start = rowIndex * colCount
    const end = start + colCount
    rows.push(data.slice(start, end))
  }
  return rows
}

const dotProduct = (left: Float32Array, right: Float32Array): number => {
  const size = Math.min(left.length, right.length)
  let total = 0
  for (let index = 0; index < size; index += 1) {
    total += left[index] * right[index]
  }
  return total
}

const buildSemanticMatches = (input: {
  entries: SemanticDocIndexEntry[]
  queryEmbedding: Float32Array
  scopeBlockIds: string[]
  queryText: string
}): DocxSearchMatch[] => {
  const scope = input.scopeBlockIds.length > 0 ? new Set(input.scopeBlockIds) : null
  const normalizedQuery = input.queryText.trim().toLowerCase()
  const scored = input.entries
    .filter((entry) => (scope ? scope.has(entry.blockId) : true))
    .map((entry) => {
      const text = entry.text.trim()
      const textLower = text.toLowerCase()
      const tokenBoost =
        normalizedQuery && textLower.includes(normalizedQuery)
          ? 0.35
          : normalizedQuery
            ? normalizedQuery
                .split(/\s+/)
                .filter(Boolean)
                .reduce((score, token) => (textLower.includes(token) ? score + 0.12 : score), 0)
            : 0
      return {
        blockId: entry.blockId,
        text: entry.text,
        score: dotProduct(entry.embedding, input.queryEmbedding) + tokenBoost
      }
    })
    .filter((item) => item.text.trim().length > 0)
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, 8).map((item) => ({
    blockId: item.blockId,
    text: item.text,
    offsets: []
  }))
}

const resolveDocxPath = (input: {
  workspaceRootPath: string
  cwd: string
  rawPath: string
}): string | null => {
  const resolved = resolveWorkspacePath({
    rawPath: input.rawPath,
    cwd: input.cwd,
    rootPath: input.workspaceRootPath
  })
  if (!resolved) return null
  if (!resolved.toLowerCase().endsWith('.docx')) return null
  return resolved
}

const runSpecSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: z.string().optional()
})

const paragraphSpecSchema = z.object({
  kind: z.literal('paragraph'),
  style: z.string().optional(),
  runs: z.array(runSpecSchema).min(1)
})

const tableCellSpecSchema = z.object({
  paragraphs: z.array(paragraphSpecSchema).min(1)
})

const tableSpecSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(z.array(tableCellSpecSchema).min(1)).min(1)
})

const blockSpecSchema = z.union([paragraphSpecSchema, tableSpecSchema])

const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    content: blockSpecSchema
  }),
  z.object({
    type: z.literal('insert_after'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('insert_before'),
    anchorBlockId: z.string().min(1),
    content: z.array(blockSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('delete_block'),
    blockId: z.string().min(1)
  }),
  z.object({
    type: z.literal('update_table_cell'),
    blockId: z.string().min(1),
    content: z.array(paragraphSpecSchema).min(1)
  }),
  z.object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    replaceAll: z.boolean().optional(),
    blockIds: z.array(z.string().min(1)).optional()
  })
])

const openSchema = z.object({
  sourcePath: z.string().min(1)
})

const outlineSchema = z.object({
  docId: z.string().min(1).optional(),
  maxBlocks: z.number().int().min(1).max(2000).optional(),
  includeTables: z.boolean().optional(),
  includeCells: z.boolean().optional()
})

const getBlockSchema = z.object({
  docId: z.string().min(1).optional(),
  blockId: z.string().min(1)
})

const searchSchema = z.object({
  docId: z.string().min(1).optional(),
  query: z.string().min(1),
  mode: z.enum(['literal', 'regex', 'semantic']),
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

const applyOpsSchema = z.object({
  docId: z.string().min(1).optional(),
  ops: z.array(docOpSchema).min(1)
})

const historySchema = z.object({
  docId: z.string().min(1).optional(),
  maxDepth: z.number().int().min(1).max(100).optional()
})

const rollbackSchema = z.object({
  docId: z.string().min(1).optional(),
  targetDocId: z.string().min(1).optional(),
  steps: z.number().int().min(1).max(50).optional()
})

const renderPreviewSchema = z.object({
  docId: z.string().min(1).optional(),
  format: z.enum(['html', 'png', 'pdf']),
  range: z
    .object({
      fromBlockId: z.string().optional(),
      toBlockId: z.string().optional()
    })
    .optional()
})

const saveSchema = z.object({
  docId: z.string().min(1),
  outPath: z.string().min(1),
  overwrite: z.boolean().optional()
})

const validateSchema = z.object({
  docId: z.string().min(1).optional()
})

const toFailure = (input: {
  code: 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  error: string
  warnings?: string[]
}) => {
  return {
    ok: false,
    code: input.code,
    summary: input.error,
    error: input.error,
    warnings: input.warnings || []
  }
}

export const buildDocxCapabilityTools = (input: DocxCapabilityToolsInput) => {
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    semanticIndexByDocId: new Map(),
    snapshotEntryByDocId: new Map()
  }

  const workspaceRootPath = path.resolve(input.workspaceRootPath)

  const emitStarted = (toolName: string, args: IpcJsonObject) => {
    const toolCallId = randomUUID()
    input.ctx.sendEvent({
      type: 'tool_call_started',
      runId: input.runId,
      taskId: input.taskId,
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
    error?: string,
    draftDocId?: string
  ) => {
    const sourcePath =
      draftDocId && state.sourcePathByDocId.has(draftDocId)
        ? state.sourcePathByDocId.get(draftDocId)
        : undefined
    input.ctx.sendEvent({
      type: 'tool_call_result',
      runId: input.runId,
      taskId: input.taskId,
      toolCallId,
      toolName,
      outputPreview,
      draftRef: draftDocId
        ? {
            draftSnapshotId: draftDocId,
            sourcePath,
            format: 'docx'
          }
        : undefined,
      completedAt: Date.now(),
      error
    })
  }

  const callWorker = async (request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>) => {
    const client = getDocxWorkerClient()
    return await client.call({
      ...request,
      runId: input.runId
    } as DocxWorkerRequest, 45_000)
  }

  const resolveTrackedDocId = (docId?: string): string | null => {
    const normalized = String(docId || '').trim()
    if (normalized) return normalized
    const lastDocId = String(state.lastDocId || '').trim()
    return lastDocId || null
  }

  const expandReplaceTextOp = async (
    docId: string,
    op: Extract<DocxOp, { type: 'replace_text' }>
  ): Promise<DocxOp[]> => {
    if (Array.isArray(op.blockIds) && op.blockIds.length > 0) {
      return op.blockIds.map((blockId) => ({
        ...op,
        blockIds: [blockId]
      }))
    }

    const searchResponse = await callWorker({
      action: 'search',
      payload: {
        docId,
        query: op.query,
        mode: 'literal',
        scopeBlockIds: []
      }
    })
    if (!searchResponse.ok) {
      return [op]
    }
    if (searchResponse.payload.action !== 'search') {
      throw new Error('worker protocol mismatch (replace_text expand search)')
    }
    const blockIds = searchResponse.payload.matches.map((match) => match.blockId).filter(Boolean)
    if (blockIds.length === 0) return [op]
    return blockIds.map((blockId) => ({
      ...op,
      blockIds: [blockId]
    }))
  }

  const expandOpsForReview = async (docId: string, ops: DocxOp[]): Promise<DocxOp[]> => {
    const expanded: DocxOp[] = []
    for (const op of ops) {
      if (op.type === 'replace_text') {
        expanded.push(...(await expandReplaceTextOp(docId, op)))
        continue
      }
      expanded.push(op)
    }
    return expanded
  }

  const buildSemanticDocIndex = async (docId: string): Promise<SemanticDocIndex> => {
    const cached = state.semanticIndexByDocId.get(docId)
    if (cached) return cached

    const outlineResponse = await callWorker({
      action: 'outline',
      payload: {
        docId,
        maxBlocks: 2000,
        includeTables: true,
        includeCells: true
      }
    })
    if (!outlineResponse.ok) {
      throw new Error(outlineResponse.error)
    }
    if (outlineResponse.payload.action !== 'outline') {
      throw new Error('worker protocol mismatch (semantic outline)')
    }

    const searchableBlocks = outlineResponse.payload.blocks.filter(isSemanticSearchableBlock)
    const texts = searchableBlocks.map((block) => block.text.trim()).filter(Boolean)
    const blocks = searchableBlocks.filter((block) => block.text.trim().length > 0)

    if (blocks.length === 0) {
      const emptyIndex = { entries: [] }
      state.semanticIndexByDocId.set(docId, emptyIndex)
      return emptyIndex
    }

    const embeddings = await input.ctx.embeddingService.embed(texts)
    const rows = splitEmbeddingRows(embeddings.data, embeddings.dims)
    if (rows.length !== blocks.length) {
      throw new Error(
        `semantic index row mismatch: blocks=${String(blocks.length)}, rows=${String(rows.length)}`
      )
    }

    const index: SemanticDocIndex = {
      entries: blocks.map((block, indexRow) => ({
        blockId: block.blockId,
        text: block.text,
        embedding: rows[indexRow]
      }))
    }
    state.semanticIndexByDocId.set(docId, index)
    return index
  }

  const registerSnapshot = (docId: string, parentDocId?: string) => {
    state.snapshotEntryByDocId.set(docId, {
      docId,
      parentDocId,
      createdAt: Date.now()
    })
  }

  const buildSnapshotHistory = (docId: string, maxDepth: number): DocxSnapshotLineageEntry[] => {
    const entries: DocxSnapshotLineageEntry[] = []
    let currentDocId = docId
    let traversed = 0

    while (currentDocId && traversed < maxDepth) {
      const entry = state.snapshotEntryByDocId.get(currentDocId)
      if (!entry) break
      entries.push(entry)
      currentDocId = entry.parentDocId || ''
      traversed += 1
    }

    return entries
  }

  const resolveRollbackTarget = (
    docId: string,
    targetDocId?: string,
    steps?: number
  ): { ok: true; targetDocId: string; stepsApplied: number } | { ok: false; error: string } => {
    const currentEntry = state.snapshotEntryByDocId.get(docId)
    if (!currentEntry) {
      return {
        ok: false,
        error: 'docId is not tracked in current docx snapshot history'
      }
    }

    if (targetDocId) {
      let cursor = docId
      let stepsApplied = 0
      while (cursor) {
        if (cursor === targetDocId) {
          return {
            ok: true,
            targetDocId,
            stepsApplied
          }
        }
        const entry = state.snapshotEntryByDocId.get(cursor)
        if (!entry?.parentDocId) break
        cursor = entry.parentDocId
        stepsApplied += 1
      }
      return {
        ok: false,
        error: 'targetDocId must be the current snapshot or one of its ancestors'
      }
    }

    let cursor = docId
    const targetSteps = Math.max(1, Number(steps || 1))
    let stepsApplied = 0
    while (stepsApplied < targetSteps) {
      const entry = state.snapshotEntryByDocId.get(cursor)
      if (!entry?.parentDocId) {
        return {
          ok: false,
          error: 'rollback target exceeds available parent snapshots'
        }
      }
      cursor = entry.parentDocId
      stepsApplied += 1
    }
    return {
      ok: true,
      targetDocId: cursor,
      stepsApplied
    }
  }

  const docxOpenTool = tool(
    async (args) => {
      const toolName = 'docx_open'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        const sourcePath = resolveDocxPath({
          workspaceRootPath,
          cwd: workspaceRootPath,
          rawPath: args.sourcePath
        })
        if (!sourcePath) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'sourcePath must be a workspace-bound .docx path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (!fs.existsSync(sourcePath)) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'sourcePath not found'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        input.emitActivity({
          actionType: 'docx_open',
          status: 'started',
          summary: `打开文档: ${sourcePath}`
        })

        const workerResponse = await callWorker({
          action: 'open',
          payload: {
            sourcePath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_open',
            status: 'failed',
            summary: `文档打开失败: ${workerResponse.error}`
          })
          return out
        }

        if (workerResponse.payload.action !== 'open') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (open)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        state.lastDocId = workerResponse.payload.docId
        state.sourcePathByDocId.set(workerResponse.payload.docId, sourcePath)
        registerSnapshot(workerResponse.payload.docId)
        input.ctx.trackDocxOpen({
          docId: workerResponse.payload.docId,
          sourcePath
        })
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc opened: ${path.basename(sourcePath)}`,
          docId: workerResponse.payload.docId,
          meta: workerResponse.payload.meta,
          stats: workerResponse.payload.stats
        }
        emitResult(toolName, toolCallId, out, undefined, workerResponse.payload.docId)
        input.emitActivity({
          actionType: 'docx_open',
          status: 'completed',
          summary: `文档已打开: ${path.basename(sourcePath)}`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({
          code: 'failed',
          error: msg
        })
        emitResult(toolName, toolCallId, out, out.error)
        input.emitActivity({
          actionType: 'docx_open',
          status: 'failed',
          summary: `文档打开异常: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_open',
      description: 'Open a workspace-bound docx file and register a docId for subsequent operations.',
      schema: openSchema
    }
  )

  const docxOutlineTool = tool(
    async (args) => {
      const toolName = 'docx_outline'
      const toolCallId = emitStarted(toolName, args)
      try {
        input.ctx.checkCancelled()
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_outline; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        input.emitActivity({
          actionType: 'docx_outline',
          status: 'started',
          summary: `提取结构: ${docId}`
        })
        const workerResponse = await callWorker({
          action: 'outline',
          payload: {
            docId,
            maxBlocks: Number(args.maxBlocks || 200),
            includeTables: Boolean(args.includeTables ?? true),
            includeCells: Boolean(args.includeCells ?? true)
          }
        })

        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_outline',
            status: 'failed',
            summary: out.summary
          })
          return out
        }

        if (workerResponse.payload.action !== 'outline') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (outline)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `outline ready (${workerResponse.payload.blocks.length} blocks)`,
          blocks: workerResponse.payload.blocks,
          truncated: workerResponse.payload.truncated
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          blockCount: out.blocks.length,
          truncated: out.truncated
        }, undefined, docId)
        input.emitActivity({
          actionType: 'docx_outline',
          status: 'completed',
          summary: `结构提取完成: ${out.blocks.length} blocks`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_outline',
      description:
        'Extract a deterministic block outline for a previously opened doc (paragraph/table/table_cell).',
      schema: outlineSchema
    }
  )

  const docxGetBlockTool = tool(
    async (args) => {
      const toolName = 'docx_get_block'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_get_block; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const workerResponse = await callWorker({
          action: 'get_block',
          payload: {
            docId,
            blockId: args.blockId
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'get_block') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (get_block)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `block loaded: ${args.blockId}`,
          block: workerResponse.payload.block
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          blockType: out.block.type
        }, undefined, docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_get_block',
      description: 'Get one block by blockId with detailed structure.',
      schema: getBlockSchema
    }
  )

  const docxSearchTool = tool(
    async (args) => {
      const toolName = 'docx_search'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_search; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (args.mode === 'semantic') {
          const semanticIndex = await buildSemanticDocIndex(docId)
          const queryEmbeddingResponse = await input.ctx.embeddingService.embed(args.query)
          const queryEmbeddingRows = splitEmbeddingRows(
            queryEmbeddingResponse.data,
            queryEmbeddingResponse.dims
          )
          const queryEmbedding = queryEmbeddingRows[0]
          if (!queryEmbedding || queryEmbedding.length === 0) {
            const out = toFailure({
              code: 'failed',
              error: 'semantic query embedding is empty'
            })
            emitResult(toolName, toolCallId, out, out.error)
            return out
          }

          const matches = buildSemanticMatches({
            entries: semanticIndex.entries,
            queryEmbedding,
            scopeBlockIds: args.scope?.blockIds || [],
            queryText: args.query
          })
          const warnings =
            semanticIndex.entries.length === 0
              ? ['no searchable paragraph or table cell blocks found for semantic search']
              : []
          const out = {
            ok: true,
            code: 'ok' as const,
            summary: `semantic search done (${matches.length} matches)`,
            matches,
            warnings
          }
          emitResult(toolName, toolCallId, {
            ok: out.ok,
            code: out.code,
            summary: out.summary,
            matchCount: out.matches.length,
            warnings: out.warnings
          }, undefined, docId)
          return out
        }

        const workerResponse = await callWorker({
          action: 'search',
          payload: {
            docId,
            query: args.query,
            mode: args.mode,
            scopeBlockIds: args.scope?.blockIds || []
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'search') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (search)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `search done (${workerResponse.payload.matches.length} matches)`,
          matches: workerResponse.payload.matches,
          warnings: workerResponse.payload.warnings
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          matchCount: out.matches.length,
          warnings: out.warnings
        }, undefined, docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_search',
      description:
        'Search blocks in a doc using literal/regex mode, or semantic block retrieval with cached embeddings.',
      schema: searchSchema
    }
  )

  const docxApplyOpsTool = tool(
    async (args) => {
      const toolName = 'docx_apply_ops'
      const toolCallId = emitStarted(toolName, args)
      try {
        const initialDocId = resolveTrackedDocId(args.docId)
        if (!initialDocId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_apply_ops; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const expandedOps = await expandOpsForReview(initialDocId, args.ops as DocxOp[])
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'started',
          summary: `应用操作: ${expandedOps.length} 条`
        })
        let currentDocId = initialDocId
        const collectedChangedBlocks: DocxChangedBlock[] = []
        const collectedWarnings: string[] = []

        for (const op of expandedOps) {
          const workerResponse = await callWorker({
            action: 'apply_ops',
            payload: {
              docId: currentDocId,
              ops: [op]
            }
          })

          if (!workerResponse.ok) {
            const out = toFailure({
              code: workerResponse.code,
              error: workerResponse.error,
              warnings: workerResponse.warnings
            })
            emitResult(toolName, toolCallId, out, out.error, currentDocId)
            input.emitActivity({
              actionType: 'docx_apply_ops',
              status: 'failed',
              summary: out.summary
            })
            return out
          }

          if (workerResponse.payload.action !== 'apply_ops') {
            const out = toFailure({
              code: 'failed',
              error: 'worker protocol mismatch (apply_ops)'
            })
            emitResult(toolName, toolCallId, out, out.error, currentDocId)
            return out
          }

          const nextDocId = workerResponse.payload.newDocId
          const sourcePath = state.sourcePathByDocId.get(currentDocId)
          if (sourcePath) state.sourcePathByDocId.set(nextDocId, sourcePath)
          registerSnapshot(nextDocId, currentDocId)
          input.ctx.trackDocxChanges({
            previousDocId: currentDocId,
            nextDocId,
            op,
            changedBlocks: workerResponse.payload.changedBlocks
          })
          collectedChangedBlocks.push(...workerResponse.payload.changedBlocks)
          collectedWarnings.push(...workerResponse.payload.warnings)
          currentDocId = nextDocId
        }

        state.lastDocId = currentDocId
        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `ops applied (${collectedChangedBlocks.length} changes)`,
          newDocId: currentDocId,
          changedBlocks: collectedChangedBlocks,
          warnings: collectedWarnings
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          newDocId: out.newDocId,
          changedCount: out.changedBlocks.length,
          warnings: out.warnings
        }, undefined, currentDocId)
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'completed',
          summary: `编辑完成: ${out.changedBlocks.length} 处变更`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        input.emitActivity({
          actionType: 'docx_apply_ops',
          status: 'failed',
          summary: `编辑失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_apply_ops',
      description:
        'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
      schema: applyOpsSchema
    }
  )

  const docxGetHistoryTool = tool(
    async (args) => {
      const toolName = 'docx_get_history'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_get_history; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const history = buildSnapshotHistory(docId, Number(args.maxDepth || 10))
        if (history.length === 0) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is not tracked in current docx snapshot history'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `snapshot history loaded (${history.length} items)`,
          currentDocId: docId,
          snapshots: history
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          snapshotCount: out.snapshots.length
        }, undefined, docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_get_history',
      description:
        'Inspect the immutable docx snapshot lineage for the current run. Useful for confirm/rollback flows before save.',
      schema: historySchema
    }
  )

  const docxRollbackTool = tool(
    async (args) => {
      const toolName = 'docx_rollback'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_rollback; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        input.emitActivity({
          actionType: 'docx_rollback',
          status: 'started',
          summary: `准备回滚文档快照: ${docId}`
        })

        const resolved = resolveRollbackTarget(docId, args.targetDocId, args.steps)
        if (!resolved.ok) {
          const out = toFailure({
            code: 'invalid_input',
            error: resolved.error
          })
          emitResult(toolName, toolCallId, out, out.error)
          input.emitActivity({
            actionType: 'docx_rollback',
            status: 'failed',
            summary: out.summary
          })
          return out
        }

        state.lastDocId = resolved.targetDocId
        const sourcePath = state.sourcePathByDocId.get(docId)
        if (sourcePath && !state.sourcePathByDocId.has(resolved.targetDocId)) {
          state.sourcePathByDocId.set(resolved.targetDocId, sourcePath)
        }

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `rollback ready (${resolved.stepsApplied} step${resolved.stepsApplied === 1 ? '' : 's'}, not saved)`,
          docId: resolved.targetDocId,
          previousDocId: docId,
          stepsApplied: resolved.stepsApplied
        }
        emitResult(toolName, toolCallId, out, undefined, resolved.targetDocId)
        input.emitActivity({
          actionType: 'docx_rollback',
          status: 'completed',
          summary: `已切回草稿快照: ${resolved.targetDocId}`
        })
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        input.emitActivity({
          actionType: 'docx_rollback',
          status: 'failed',
          summary: `回滚失败: ${msg}`
        })
        throw error
      }
    },
    {
      name: 'docx_rollback',
      description:
        'Move back to an ancestor docx snapshot in the current run without writing files. Use before user confirmation.',
      schema: rollbackSchema
    }
  )

  const docxRenderPreviewTool = tool(
    async (args) => {
      const toolName = 'docx_render_preview'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_render_preview; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const previewDir = path.join(workspaceRootPath, '.ncurator', 'docx-previews')
        const previewPath = path.join(
          previewDir,
          `${input.runId}-${docId}-${Date.now().toString(36)}.docx`
        )
        const existsBefore = fs.existsSync(previewPath)
        const workerResponse = await callWorker({
          action: 'render_preview',
          payload: {
            docId,
            format: args.format,
            previewPath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'render_preview') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (render_preview)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        input.ctx.trackDocxPreview({
          docId,
          previewPath: workerResponse.payload.previewPath
        })
        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId,
          capability: 'docx',
          artifactPath: workerResponse.payload.previewPath,
          operation,
          artifactRole: 'preview',
          draftSnapshotId: docId,
          summary: `docx preview generated (${workerResponse.payload.renderer})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `preview generated (${workerResponse.payload.format})`,
          format: workerResponse.payload.format,
          previewPath: workerResponse.payload.previewPath,
          renderer: workerResponse.payload.renderer
        }
        emitResult(toolName, toolCallId, out, undefined, docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_render_preview',
      description:
        'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
      schema: renderPreviewSchema
    }
  )

  const docxSaveTool = tool(
    async (args) => {
      const toolName = 'docx_save'
      const toolCallId = emitStarted(toolName, args)
      try {
        const sourcePath = state.sourcePathByDocId.get(args.docId)
        const cwd = sourcePath ? path.dirname(sourcePath) : workspaceRootPath
        const outPath = resolveDocxPath({
          workspaceRootPath,
          cwd,
          rawPath: args.outPath
        })
        if (!outPath) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'outPath must be a workspace-bound .docx path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const existsBefore = fs.existsSync(outPath)
        if (existsBefore && !args.overwrite) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'outPath already exists, pass overwrite=true or use another path'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        if (existsBefore) {
          const decision = await input.ctx.requestApproval({
            runId: input.runId,
            taskId: input.taskId,
            command: `docx overwrite ${outPath}`,
            riskLevel: 'medium',
            reason: 'docx save may overwrite an existing file'
          })
          if (!decision.approved) {
            const out = toFailure({
              code: 'approval_denied',
              error: decision.reason || 'approval denied for overwrite'
            })
            emitResult(toolName, toolCallId, out, out.error)
            return out
          }
        }

        const workerResponse = await callWorker({
          action: 'save',
          payload: {
            docId: args.docId,
            outPath
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'save') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (save)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }

        const operation: AiFileArtifactOperation = existsBefore ? 'updated' : 'created'
        emitFileArtifactEvent({
          ctx: input.ctx,
          runId: input.runId,
          taskId: input.taskId,
          capability: 'docx',
          artifactPath: outPath,
          operation,
          artifactRole: 'committed',
          draftSnapshotId: args.docId,
          summary: `docx saved (${operation})`
        })

        const out = {
          ok: true,
          code: 'ok' as const,
          summary: `doc saved: ${path.basename(outPath)}`,
          outPath,
          checksum: workerResponse.payload.checksum,
          operation,
          byteSize: workerResponse.payload.byteSize
        }
        emitResult(toolName, toolCallId, out, undefined, args.docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_save',
      description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
      schema: saveSchema
    }
  )

  const docxValidateTool = tool(
    async (args) => {
      const toolName = 'docx_validate'
      const toolCallId = emitStarted(toolName, args)
      try {
        const docId = resolveTrackedDocId(args.docId)
        if (!docId) {
          const out = toFailure({
            code: 'invalid_input',
            error: 'docId is required before docx_validate; open a document first'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const workerResponse = await callWorker({
          action: 'validate',
          payload: {
            docId
          }
        })
        if (!workerResponse.ok) {
          const out = toFailure({
            code: workerResponse.code,
            error: workerResponse.error,
            warnings: workerResponse.warnings
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        if (workerResponse.payload.action !== 'validate') {
          const out = toFailure({
            code: 'failed',
            error: 'worker protocol mismatch (validate)'
          })
          emitResult(toolName, toolCallId, out, out.error)
          return out
        }
        const out = {
          ok: true,
          code: 'ok' as const,
          summary:
            workerResponse.payload.problems.length === 0
              ? 'docx validate ok'
              : `docx validate with ${workerResponse.payload.problems.length} problems`,
          problems: workerResponse.payload.problems
        }
        emitResult(toolName, toolCallId, {
          ok: out.ok,
          code: out.code,
          summary: out.summary,
          problemsPreview: clipText(JSON.stringify(out.problems), input.safePreviewChars)
        }, undefined, docId)
        return out
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const out = toFailure({ code: 'failed', error: msg })
        emitResult(toolName, toolCallId, out, out.error)
        throw error
      }
    },
    {
      name: 'docx_validate',
      description: 'Validate current doc snapshot structure and relationship consistency.',
      schema: validateSchema
    }
  )

  return {
    tools: [
      docxOpenTool,
      docxOutlineTool,
      docxGetBlockTool,
      docxSearchTool,
      docxApplyOpsTool,
      docxGetHistoryTool,
      docxRollbackTool,
      docxRenderPreviewTool,
      docxSaveTool,
      docxValidateTool
    ],
    state
  }
}
