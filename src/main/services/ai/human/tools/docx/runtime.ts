import path from 'node:path'
import type { DocxCapabilityToolsInput, DocxCapabilityToolsRuntimeState, DocxOp, DocxSnapshotLineageEntry, DocxToolResultCode, SemanticDocIndex } from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest, DocxWorkerResponse } from './worker/types'
import { resolveWorkspacePath } from '../terminal/terminalCwd'
import { isSemanticSearchableBlock, splitEmbeddingRows } from './semanticSearch'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'

type FailedWorkerResponse = Extract<DocxWorkerResponse, { ok: false }>
type RequireDocIdResult = { docId: string } | { failure: DocxToolFailure }

export type DocxToolFailure = {
  ok: false
  code: DocxToolResultCode
  summary: string
  error: string
  warnings: string[]
}

export type DocxToolRuntime = {
  input: DocxCapabilityToolsInput
  state: DocxCapabilityToolsRuntimeState
  workspaceRootPath: string
  toolEvents: ToolEventEmitter
  emitFailure: (input: {
    toolName: string
    toolCallId: string
    code: DocxToolResultCode
    error: string
    warnings?: string[]
    draftDocId?: string
  }) => DocxToolFailure
  emitWorkerFailure: (input: {
    toolName: string
    toolCallId: string
    response: FailedWorkerResponse
    draftDocId?: string
  }) => DocxToolFailure
  callWorker: (request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>) => Promise<DocxWorkerResponse>
  resolveDocxPath: (input: { cwd: string; rawPath: string }) => string | null
  resolveTrackedDocId: (docId?: string) => string | null
  requireDocId: (input: {
    toolName: string
    toolCallId: string
    docId?: string
  }) => RequireDocIdResult
  registerSnapshot: (docId: string, parentDocId?: string) => void
  buildSnapshotHistory: (docId: string, maxDepth: number) => DocxSnapshotLineageEntry[]
  resolveRollbackTarget: (
    docId: string,
    targetDocId?: string,
    steps?: number
  ) => { ok: true; targetDocId: string; stepsApplied: number } | { ok: false; error: string }
  expandOpsForReview: (docId: string, ops: DocxOp[]) => Promise<DocxOp[]>
  buildSemanticDocIndex: (docId: string) => Promise<SemanticDocIndex>
}

const resolveTrackedDocIdFromState = (
  state: DocxCapabilityToolsRuntimeState,
  docId?: string
): string | null => {
  const normalized = String(docId || '').trim()
  if (normalized) return normalized
  const lastDocId = String(state.lastDocId || '').trim()
  return lastDocId || null
}

const buildRequiredDocIdError = (toolName: string): string =>
  `docId is required before ${toolName}; open a document first`

export const createDocxToolRuntime = (input: DocxCapabilityToolsInput): DocxToolRuntime => {
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    semanticIndexByDocId: new Map(),
    snapshotEntryByDocId: new Map()
  }
  const workspaceRootPath = path.resolve(input.workspaceRootPath)
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    resolveDraftRef: (draftDocId) => ({
      draftSnapshotId: draftDocId,
      sourcePath: state.sourcePathByDocId.get(draftDocId),
      format: 'docx'
    })
  })

  const toFailure = (params: {
    code: DocxToolResultCode
    error: string
    warnings?: string[]
  }): DocxToolFailure => ({
    ok: false,
    code: params.code,
    summary: params.error,
    error: params.error,
    warnings: params.warnings || []
  })

  const emitFailure = (params: {
    toolName: string
    toolCallId: string
    code: DocxToolResultCode
    error: string
    warnings?: string[]
    draftDocId?: string
  }): DocxToolFailure => {
    const out = toFailure({
      code: params.code,
      error: params.error,
      warnings: params.warnings
    })
    toolEvents.emitResult({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      outputPreview: out,
      error: out.error,
      draftDocId: params.draftDocId
    })
    return out
  }

  const emitWorkerFailure = (params: {
    toolName: string
    toolCallId: string
    response: FailedWorkerResponse
    draftDocId?: string
  }) =>
    emitFailure({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      code: params.response.code,
      error: params.response.error,
      warnings: params.response.warnings,
      draftDocId: params.draftDocId
    })

  const callWorker = async (
    request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>
  ): Promise<DocxWorkerResponse> => {
    const client = getDocxWorkerClient()
    return await client.call(
      {
        ...request,
        runId: input.runId
      } as DocxWorkerRequest,
      45_000
    )
  }

  const resolveDocxPath = (params: { cwd: string; rawPath: string }): string | null => {
    const resolved = resolveWorkspacePath({
      rawPath: params.rawPath,
      cwd: params.cwd,
      rootPath: workspaceRootPath
    })
    if (!resolved) return null
    if (!resolved.toLowerCase().endsWith('.docx')) return null
    return resolved
  }

  const resolveTrackedDocId = (docId?: string): string | null => resolveTrackedDocIdFromState(state, docId)

  const requireDocId = (params: {
    toolName: string
    toolCallId: string
    docId?: string
  }): RequireDocIdResult => {
    const docId = resolveTrackedDocId(params.docId)
    if (docId) return { docId }
    return {
      failure: emitFailure({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        code: 'invalid_input',
        error: buildRequiredDocIdError(params.toolName)
      })
    }
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

    const semanticIndex: SemanticDocIndex = {
      entries: blocks.map((block, indexRow) => ({
        blockId: block.blockId,
        text: block.text,
        embedding: rows[indexRow]
      }))
    }
    state.semanticIndexByDocId.set(docId, semanticIndex)
    return semanticIndex
  }

  return {
    input,
    state,
    workspaceRootPath,
    toolEvents,
    emitFailure,
    emitWorkerFailure,
    callWorker,
    resolveDocxPath,
    resolveTrackedDocId,
    requireDocId,
    registerSnapshot,
    buildSnapshotHistory,
    resolveRollbackTarget,
    expandOpsForReview,
    buildSemanticDocIndex
  }
}
