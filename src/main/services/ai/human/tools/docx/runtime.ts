import path from 'node:path'
import type { AiToolCallResult, JsonObject } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxDocumentSession,
  DocxOp,
  DocxReplaySession,
  DocxRevision,
  DocxToolResultCode,
  SemanticDocIndex
} from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest, DocxWorkerResponse } from './worker/types'
import { resolveWorkspacePath } from '../terminal/terminalCwd'
import { isSemanticSearchableBlock, splitEmbeddingRows } from './semanticSearch'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'

type FailedWorkerResponse = Extract<DocxWorkerResponse, { ok: false }>

export type DocxToolResourceContext = {
  family: 'docx'
  sourcePath: string
  currentRevisionRef?: string
  previousRevisionRef?: string
  effectKind?: 'opened' | 'read' | 'searched' | 'mutated' | 'rolled_back' | 'history'
}

type RequireDocSessionResult =
  | { sourcePath: string; session: DocxDocumentSession; docId: string; currentRevisionRef: string }
  | { failure: DocxToolFailure }

const isToolResultRecord = (value: AiToolCallResult['data']): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const buildDocxToolCallResult = (input: {
  toolName: string
  ok: boolean
  code: DocxToolResultCode
  data: AiToolCallResult['data']
  resourceContext?: DocxToolResourceContext
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  code: input.code,
  data: input.data,
  resourceContext: input.resourceContext,
  diagnostic:
    input.ok || !isToolResultRecord(input.data)
      ? undefined
      : typeof input.data.error === 'string' && input.data.error.trim()
        ? { message: input.data.error.trim() }
        : undefined
})

export type DocxToolFailure = {
  ok: false
  code: DocxToolResultCode
  summary: string
  error: string
  warnings: string[]
  resourceContext?: DocxToolResourceContext
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
    resourceContext?: DocxToolResourceContext
  }) => DocxToolFailure
  emitWorkerFailure: (input: {
    toolName: string
    toolCallId: string
    response: FailedWorkerResponse
    draftDocId?: string
    resourceContext?: DocxToolResourceContext
  }) => DocxToolFailure
  callWorker: (request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>) => Promise<DocxWorkerResponse>
  resolveDocxPath: (input: { cwd: string; rawPath: string }) => string | null
  getDocumentSession: (sourcePath: string) => DocxDocumentSession | undefined
  getReplaySession: (sourcePath: string) => DocxReplaySession | undefined
  ensureDocumentSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }) => Promise<RequireDocSessionResult>
  requireDocumentSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }) => RequireDocSessionResult
  registerOpenedDocument: (
    sourcePath: string,
    docId: string,
    meta?: DocxDocumentSession['meta'],
    stats?: DocxDocumentSession['stats']
  ) => {
    session: DocxDocumentSession
    currentRevisionRef: string
  }
  registerRevision: (input: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    changedBlocks?: DocxRevision['changedBlocks']
    summary?: string
  }) => { currentRevisionRef: string; previousRevisionRef: string }
  buildRevisionHistory: (
    sourcePath: string,
    maxDepth: number
  ) => Array<DocxRevision & { isCurrent: boolean }>
  resolveRevisionRollbackTarget: (
    sourcePath: string,
    targetRevisionRef?: string,
    steps?: number
  ) =>
    | {
        ok: true
        targetDocId: string
        targetRevisionRef: string
        previousRevisionRef: string
        stepsApplied: number
      }
    | { ok: false; error: string }
  activateRevision: (input: {
    sourcePath: string
    targetDocId: string
    targetRevisionRef: string
  }) => { previousRevisionRef: string; currentRevisionRef: string }
  expandOpsForReview: (docId: string, ops: DocxOp[]) => Promise<DocxOp[]>
  buildSemanticDocIndex: (docId: string) => Promise<SemanticDocIndex>
  getRevisionRefByDocId: (docId: string) => string | undefined
  buildResourceContext: (input: {
    sourcePath: string
    effectKind: DocxToolResourceContext['effectKind']
    currentRevisionRef?: string
    previousRevisionRef?: string
  }) => DocxToolResourceContext
}

export const createDocxToolRuntime = (input: DocxCapabilityToolsInput): DocxToolRuntime => {
  const revisionEntryByDocId = new Map<string, DocxRevision>()
  const replaySessionBySourcePath = new Map<string, DocxReplaySession>()
  const documentSessionBySourcePath = new Map<string, DocxDocumentSession>()
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    semanticIndexByDocId: new Map(),
    snapshotEntryByDocId: new Map(),
    revisionEntryByDocId,
    replaySessionBySourcePath,
    documentSessionBySourcePath
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
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => ({
    ok: false,
    code: params.code,
    summary: params.error,
    error: params.error,
    warnings: params.warnings || [],
    resourceContext: params.resourceContext
  })

  const emitFailure = (params: {
    toolName: string
    toolCallId: string
    code: DocxToolResultCode
    error: string
    warnings?: string[]
    draftDocId?: string
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => {
    const out = toFailure({
      code: params.code,
      error: params.error,
      warnings: params.warnings,
      resourceContext: params.resourceContext
    })
    toolEvents.emitResult({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      outputPreview: out,
      result: buildDocxToolCallResult({
        toolName: params.toolName,
        ok: false,
        code: out.code,
        data: out,
        resourceContext: out.resourceContext
      }),
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
    resourceContext?: DocxToolResourceContext
  }) =>
    emitFailure({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      code: params.response.code,
      error: params.response.error,
      warnings: params.response.warnings,
      draftDocId: params.draftDocId,
      resourceContext: params.resourceContext
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

  const getDocumentSession = (sourcePath: string): DocxDocumentSession | undefined =>
    state.documentSessionBySourcePath.get(path.resolve(sourcePath))

  const getReplaySession = (sourcePath: string): DocxReplaySession | undefined =>
    state.replaySessionBySourcePath.get(path.resolve(sourcePath))

  const getRevisionRefByDocId = (docId: string): string | undefined =>
    state.revisionEntryByDocId.get(docId)?.revisionRef

  const buildSessionResult = (
    sourcePath: string,
    session: DocxDocumentSession
  ): Exclude<RequireDocSessionResult, { failure: DocxToolFailure }> => ({
    sourcePath,
    session,
    docId: session.activeDocId,
    currentRevisionRef: session.activeRevisionRef
  })

  const requireDocumentSession = (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }): RequireDocSessionResult => {
    const sourcePath = path.resolve(params.sourcePath)
    const session = getDocumentSession(sourcePath)
    if (session) {
      return buildSessionResult(sourcePath, session)
    }
    return {
      failure: emitFailure({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        code: 'invalid_input',
        error: `sourcePath must be opened before ${params.toolName}: ${sourcePath}`,
        resourceContext: {
          family: 'docx',
          sourcePath
        }
      })
    }
  }

  const ensureDocumentSession = async (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }): Promise<RequireDocSessionResult> => {
    const requestedSourcePath = resolveDocxPath({
      cwd: workspaceRootPath,
      rawPath: params.sourcePath
    })
    if (!requestedSourcePath) {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          code: 'invalid_input',
          error: 'sourcePath must be a workspace-bound .docx path'
        })
      }
    }

    const existingSession = getDocumentSession(requestedSourcePath)
    if (existingSession) {
      return buildSessionResult(requestedSourcePath, existingSession)
    }

    const resolvedTarget = await input.ctx.resolveDocxOpenTarget(requestedSourcePath)
    const workerResponse = await callWorker({
      action: 'open',
      payload: {
        sourcePath: resolvedTarget.openPath
      }
    })
    if (!workerResponse.ok) {
      return {
        failure: emitWorkerFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          response: workerResponse
        })
      }
    }
    if (workerResponse.payload.action !== 'open') {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          code: 'failed',
          error: 'worker protocol mismatch (open)'
        })
      }
    }

    const registered = registerOpenedDocument(
      resolvedTarget.trackedSourcePath,
      workerResponse.payload.docId,
      workerResponse.payload.meta,
      workerResponse.payload.stats
    )
    input.ctx.trackDocxOpen({
      docId: workerResponse.payload.docId,
      sourcePath: resolvedTarget.trackedSourcePath
    })
    return {
      sourcePath: registered.session.sourcePath,
      session: registered.session,
      docId: registered.session.activeDocId,
      currentRevisionRef: registered.currentRevisionRef
    }
  }

  const registerSnapshot = (docId: string, parentDocId?: string) => {
    state.snapshotEntryByDocId.set(docId, {
      docId,
      parentDocId,
      createdAt: Date.now()
    })
  }

  const registerOpenedDocument = (
    sourcePath: string,
    docId: string,
    meta?: DocxDocumentSession['meta'],
    stats?: DocxDocumentSession['stats']
  ) => {
    const normalizedSourcePath = path.resolve(sourcePath)
    const existing = state.documentSessionBySourcePath.get(normalizedSourcePath)
    if (existing) {
      return {
        session: existing,
        currentRevisionRef: existing.activeRevisionRef
      }
    }

    registerSnapshot(docId)
    state.sourcePathByDocId.set(docId, normalizedSourcePath)
    const revisionEntry: DocxRevision = {
      revisionRef: 'v1',
      docId,
      createdAt: Date.now()
    }
    state.revisionEntryByDocId.set(docId, revisionEntry)
    const docIdByRef = new Map([['v1', docId]])
    const refByDocId = new Map([[docId, 'v1']])
    const session: DocxDocumentSession = {
      sourcePath: normalizedSourcePath,
      sourceDocId: docId,
      activeDocId: docId,
      activeRevisionRef: 'v1',
      nextRevisionNumber: 2,
      meta: meta || {
        title: '',
        creator: '',
        lastModifiedBy: '',
        description: '',
        defaultFont: ''
      },
      stats: stats || {
        blockCount: 0,
        paragraphCount: 0,
        tableCount: 0,
        imageCount: 0,
        charCount: 0
      },
      docIdByRevisionRef: docIdByRef,
      revisionRefByDocId: refByDocId,
      revisionByDocId: state.revisionEntryByDocId,
      viewArtifacts: {}
    }
    state.replaySessionBySourcePath.set(normalizedSourcePath, session)
    state.documentSessionBySourcePath.set(normalizedSourcePath, session)
    return {
      session,
      currentRevisionRef: 'v1'
    }
  }

  const registerRevision = (params: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    changedBlocks?: DocxRevision['changedBlocks']
    summary?: string
  }) => {
    const sourcePath = path.resolve(params.sourcePath)
    const session = state.replaySessionBySourcePath.get(sourcePath)
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${sourcePath}`)
    }
    const previousRevisionRef = session.revisionRefByDocId.get(params.previousDocId)
    if (!previousRevisionRef) {
      throw new Error(`previous docId is not tracked in docx session: ${params.previousDocId}`)
    }
    const currentRevisionRef = `v${String(session.nextRevisionNumber)}`
    session.nextRevisionNumber += 1
    session.activeDocId = params.nextDocId
    session.activeRevisionRef = currentRevisionRef
    session.docIdByRevisionRef.set(currentRevisionRef, params.nextDocId)
    session.revisionRefByDocId.set(params.nextDocId, currentRevisionRef)
    state.sourcePathByDocId.set(params.nextDocId, sourcePath)
    registerSnapshot(params.nextDocId, params.previousDocId)
    const revisionEntry: DocxRevision = {
      revisionRef: currentRevisionRef,
      docId: params.nextDocId,
      parentRevisionRef: previousRevisionRef,
      createdAt: Date.now(),
      changedBlocks: params.changedBlocks,
      summary: params.summary
    }
    state.revisionEntryByDocId.set(params.nextDocId, revisionEntry)
    return {
      currentRevisionRef,
      previousRevisionRef
    }
  }

  const buildRevisionHistory = (
    sourcePath: string,
    maxDepth: number
  ): Array<DocxRevision & { isCurrent: boolean }> => {
    const session = state.replaySessionBySourcePath.get(path.resolve(sourcePath))
    if (!session) return []
    const entries: Array<DocxRevision & { isCurrent: boolean }> = []
    let currentRevisionRef = session.activeRevisionRef
    let traversed = 0

    while (currentRevisionRef && traversed < maxDepth) {
      const docId = session.docIdByRevisionRef.get(currentRevisionRef)
      if (!docId) break
      const entry = state.revisionEntryByDocId.get(docId)
      if (!entry) break
      entries.push({
        ...entry,
        isCurrent: currentRevisionRef === session.activeRevisionRef
      })
      currentRevisionRef = entry.parentRevisionRef || ''
      traversed += 1
    }

    return entries
  }

  const resolveRevisionRollbackTarget = (
    sourcePath: string,
    targetRevisionRef?: string,
    steps?: number
  ):
    | {
        ok: true
        targetDocId: string
        targetRevisionRef: string
        previousRevisionRef: string
        stepsApplied: number
      }
    | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `sourcePath must be opened before docx_rollback: ${path.resolve(sourcePath)}`
      }
    }

    if (targetRevisionRef) {
      let cursor = session.activeRevisionRef
      let stepsApplied = 0
      while (cursor) {
        if (cursor === targetRevisionRef) {
          const targetDocId = session.docIdByRevisionRef.get(targetRevisionRef)
          if (!targetDocId) {
            return { ok: false, error: 'targetRevisionRef is not tracked in current docx session' }
          }
          return {
            ok: true,
            targetDocId,
            targetRevisionRef,
            previousRevisionRef: session.activeRevisionRef,
            stepsApplied
          }
        }
        const docId = session.docIdByRevisionRef.get(cursor)
        const entry = docId ? state.revisionEntryByDocId.get(docId) : undefined
        if (!entry?.parentRevisionRef) break
        cursor = entry.parentRevisionRef
        stepsApplied += 1
      }
      return {
        ok: false,
        error: 'targetRevisionRef must be the current revision or one of its ancestors'
      }
    }

    let cursor = session.activeRevisionRef
    const targetSteps = Math.max(1, Number(steps || 1))
    let stepsApplied = 0
    while (stepsApplied < targetSteps) {
      const docId = session.docIdByRevisionRef.get(cursor)
      const entry = docId ? state.revisionEntryByDocId.get(docId) : undefined
      if (!entry?.parentRevisionRef) {
        return {
          ok: false,
          error: 'rollback target exceeds available parent revisions'
        }
      }
      cursor = entry.parentRevisionRef
      stepsApplied += 1
    }
    const targetDocId = session.docIdByRevisionRef.get(cursor)
    if (!targetDocId) {
      return { ok: false, error: 'rollback target is not tracked in current docx session' }
    }
    return {
      ok: true,
      targetDocId,
      targetRevisionRef: cursor,
      previousRevisionRef: session.activeRevisionRef,
      stepsApplied
    }
  }

  const activateRevision = (params: {
    sourcePath: string
    targetDocId: string
    targetRevisionRef: string
  }) => {
    const session = state.replaySessionBySourcePath.get(path.resolve(params.sourcePath))
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${params.sourcePath}`)
    }
    const previousRevisionRef = session.activeRevisionRef
    session.activeDocId = params.targetDocId
    session.activeRevisionRef = params.targetRevisionRef
    return {
      previousRevisionRef,
      currentRevisionRef: params.targetRevisionRef
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
        blockType: block.type,
        bodyIndex: block.bodyIndex,
        previousBodyBlockId: block.previousBodyBlockId,
        nextBodyBlockId: block.nextBodyBlockId,
        tableBlockId: block.type === 'table_cell' ? block.tableBlockId : undefined,
        text: block.text,
        embedding: rows[indexRow]
      }))
    }
    state.semanticIndexByDocId.set(docId, semanticIndex)
    return semanticIndex
  }

  const buildResourceContext = (params: {
    sourcePath: string
    effectKind: DocxToolResourceContext['effectKind']
    currentRevisionRef?: string
    previousRevisionRef?: string
  }): DocxToolResourceContext => ({
    family: 'docx',
    sourcePath: path.resolve(params.sourcePath),
    currentRevisionRef: params.currentRevisionRef,
    previousRevisionRef: params.previousRevisionRef,
    effectKind: params.effectKind
  })

  return {
    input,
    state,
    workspaceRootPath,
    toolEvents,
    emitFailure,
    emitWorkerFailure,
    callWorker,
    resolveDocxPath,
    getDocumentSession,
    getReplaySession,
    ensureDocumentSession,
    requireDocumentSession,
    registerOpenedDocument,
    registerRevision,
    buildRevisionHistory,
    resolveRevisionRollbackTarget,
    activateRevision,
    expandOpsForReview,
    buildSemanticDocIndex,
    getRevisionRefByDocId,
    buildResourceContext
  }
}
