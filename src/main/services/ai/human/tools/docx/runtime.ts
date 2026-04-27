import path from 'node:path'
import type { AiToolCallResult, JsonObject } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOp,
  DocxOutlineBlock,
  DocxReadSession,
  DocxReplaySession,
  DocxReplaySnapshot,
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
import {
  applyRevisionToReplaySession,
  createEmptyReplaySnapshot,
  createReplaySessionFromSnapshot,
  createReplaySnapshot
} from './review/replayTree'

type FailedWorkerResponse = Extract<DocxWorkerResponse, { ok: false }>

export type DocxToolResourceContext = {
  family: 'docx'
  sourcePath: string
  currentRevisionRef?: string
  previousRevisionRef?: string
  effectKind?: 'opened' | 'read' | 'searched' | 'mutated' | 'rolled_back' | 'history'
}

export type RequireReadSessionResult =
  | {
      sourcePath: string
      docId: string
      currentRevisionRef: string
      meta: DocxOpenMeta
      stats: DocxOpenStats
      readSession?: DocxReadSession
      replaySession?: DocxReplaySession
    }
  | { failure: DocxToolFailure }

export type RequireReplaySessionResult =
  | {
      sourcePath: string
      session: DocxReplaySession
      docId: string
      currentRevisionRef: string
    }
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
  getReadSession: (sourcePath: string) => DocxReadSession | undefined
  getReplaySession: (sourcePath: string) => DocxReplaySession | undefined
  ensureReadSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }) => Promise<RequireReadSessionResult>
  ensureReplaySession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
    reason?: 'history' | 'edit' | 'rollback'
  }) => Promise<RequireReplaySessionResult>
  registerCreatedDocument: (input: {
    sourcePath: string
    baselineDocId: string
    workingDocId: string
    meta?: DocxOpenMeta
    stats?: DocxOpenStats
    summary?: string
  }) => Promise<{
    session: DocxReplaySession
    previousRevisionRef: string
    currentRevisionRef: string
    changedBlocks: DocxRevision['changedBlocks']
    createdBlocks: DocxRevision['createdBlocks']
  }>
  registerRevision: (input: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    ops: DocxOp[]
    createdBlocks: DocxRevision['createdBlocks']
    changedBlocks?: DocxRevision['changedBlocks']
    summary?: string
  }) => Promise<{ currentRevisionRef: string; previousRevisionRef: string }>
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
  }) => Promise<{ previousRevisionRef: string; currentRevisionRef: string }>
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
  const readSessionBySourcePath = new Map<string, DocxReadSession>()
  const replaySessionBySourcePath = new Map<string, DocxReplaySession>()
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    semanticIndexByDocId: new Map(),
    snapshotEntryByDocId: new Map(),
    revisionEntryByDocId,
    readSessionBySourcePath,
    replaySessionBySourcePath
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

  const getReadSession = (sourcePath: string): DocxReadSession | undefined =>
    state.readSessionBySourcePath.get(path.resolve(sourcePath))

  const getReplaySession = (sourcePath: string): DocxReplaySession | undefined =>
    state.replaySessionBySourcePath.get(path.resolve(sourcePath))

  const getRevisionRefByDocId = (docId: string): string | undefined =>
    state.revisionEntryByDocId.get(docId)?.revisionRef

  const createReadSessionCache = (): DocxReadSession['cache'] => ({
    outlineByCacheKey: new Map(),
    detailByBlockId: new Map()
  })

  const cacheOutline = (
    session: DocxReadSession | undefined,
    key: string,
    value: { blocks: DocxOutlineBlock[]; truncated: boolean }
  ) => {
    if (!session) return
    session.cache.outlineByCacheKey.set(key, value)
  }

  const cacheDetailedBlocks = (session: DocxReadSession | undefined, blocks: readonly DocxDetailedBlock[]) => {
    if (!session) return
    blocks.forEach((block) => {
      session.cache.detailByBlockId.set(block.blockId, block)
    })
  }

  const buildReadSessionResultFromReplay = (
    sourcePath: string,
    session: DocxReplaySession
  ): Exclude<RequireReadSessionResult, { failure: DocxToolFailure }> => ({
    sourcePath,
    docId: session.activeDocId,
    currentRevisionRef: session.activeRevisionRef,
    meta: session.meta,
    stats: session.stats,
    replaySession: session
  })

  const buildReplaySessionResult = (
    sourcePath: string,
    session: DocxReplaySession
  ): Exclude<RequireReplaySessionResult, { failure: DocxToolFailure }> => ({
    sourcePath,
    session,
    docId: session.activeDocId,
    currentRevisionRef: session.activeRevisionRef
  })

  const buildReadSessionResult = (
    sourcePath: string,
    session: DocxReadSession
  ): Exclude<RequireReadSessionResult, { failure: DocxToolFailure }> => ({
    sourcePath,
    docId: session.docId,
    currentRevisionRef: session.currentRevisionRef,
    meta: session.meta,
    stats: session.stats,
    readSession: session
  })

  const registerSnapshot = (docId: string, parentDocId?: string) => {
    state.snapshotEntryByDocId.set(docId, {
      docId,
      parentDocId,
      createdAt: Date.now()
    })
  }

  const openDocumentAsReadSession = async (
    sourcePath: string
  ): Promise<DocxReadSession> => {
    const resolvedTarget = await input.ctx.resolveDocxOpenTarget(sourcePath)
    const workerResponse = await callWorker({
      action: 'open',
      payload: {
        sourcePath: resolvedTarget.openPath
      }
    })
    if (!workerResponse.ok) {
      throw new Error(workerResponse.error)
    }
    if (workerResponse.payload.action !== 'open') {
      throw new Error('worker protocol mismatch (open)')
    }
    const normalizedSourcePath = path.resolve(resolvedTarget.trackedSourcePath)
    registerSnapshot(workerResponse.payload.docId)
    state.sourcePathByDocId.set(workerResponse.payload.docId, normalizedSourcePath)
    const session: DocxReadSession = {
      sourcePath: normalizedSourcePath,
      docId: workerResponse.payload.docId,
      meta: workerResponse.payload.meta,
      stats: workerResponse.payload.stats,
      currentRevisionRef: 'v1',
      cache: createReadSessionCache()
    }
    state.readSessionBySourcePath.set(normalizedSourcePath, session)
    input.ctx.trackDocxOpen({
      docId: workerResponse.payload.docId,
      sourcePath: normalizedSourcePath
    })
    return session
  }

  const fetchOutlinePage = async (inputValue: {
    session?: DocxReadSession
    docId: string
    fromBodyIndex?: number
    maxBlocks: number
    includeTables: boolean
    includeCells: boolean
  }): Promise<{ blocks: DocxOutlineBlock[]; truncated: boolean }> => {
    const cacheKey = `${String(inputValue.fromBodyIndex || 0)}:${String(inputValue.maxBlocks)}:${inputValue.includeTables ? '1' : '0'}:${inputValue.includeCells ? '1' : '0'}`
    const cached = inputValue.session?.cache.outlineByCacheKey.get(cacheKey)
    if (cached) {
      return cached
    }
    const outlineResponse = await callWorker({
      action: 'outline',
      payload: {
        docId: inputValue.docId,
        fromBodyIndex: inputValue.fromBodyIndex,
        maxBlocks: inputValue.maxBlocks,
        includeTables: inputValue.includeTables,
        includeCells: inputValue.includeCells
      }
    })
    if (!outlineResponse.ok) {
      throw new Error(outlineResponse.error)
    }
    if (outlineResponse.payload.action !== 'outline') {
      throw new Error('worker protocol mismatch (outline)')
    }
    const result = {
      blocks: outlineResponse.payload.blocks,
      truncated: outlineResponse.payload.truncated
    }
    cacheOutline(inputValue.session || undefined, cacheKey, result)
    return result
  }

  const fetchAllOutlineBlocks = async (inputValue: {
    session?: DocxReadSession
    docId: string
    includeTables: boolean
    includeCells: boolean
  }): Promise<DocxOutlineBlock[]> => {
    const pageSize = 1000
    const blocks: DocxOutlineBlock[] = []
    let fromBodyIndex = 0
    while (true) {
      const page = await fetchOutlinePage({
        session: inputValue.session,
        docId: inputValue.docId,
        fromBodyIndex,
        maxBlocks: pageSize,
        includeTables: inputValue.includeTables,
        includeCells: inputValue.includeCells
      })
      if (page.blocks.length === 0) {
        break
      }
      blocks.push(...page.blocks)
      if (!page.truncated) {
        break
      }
      const lastBlock = page.blocks[page.blocks.length - 1]
      fromBodyIndex = (lastBlock?.bodyIndex || fromBodyIndex) + 1
    }
    return blocks
  }

  const fetchDetailedBlocksByIds = async (
    docId: string,
    blockIds: string[],
    session?: DocxReadSession
  ): Promise<DocxDetailedBlock[]> => {
    const cachedBlocks: DocxDetailedBlock[] = []
    const missingBlockIds: string[] = []
    blockIds.forEach((blockId) => {
      const cached = session?.cache.detailByBlockId.get(blockId)
      if (cached) {
        cachedBlocks.push(cached)
      } else {
        missingBlockIds.push(blockId)
      }
    })
    if (missingBlockIds.length === 0) {
      return cachedBlocks
    }
    const response = await callWorker({
      action: 'get_blocks_by_ids',
      payload: {
        docId,
        blockIds: missingBlockIds
      }
    })
    if (!response.ok) {
      throw new Error(response.error)
    }
    if (response.payload.action !== 'get_blocks_by_ids') {
      throw new Error('worker protocol mismatch (get_blocks_by_ids)')
    }
    cacheDetailedBlocks(session, response.payload.blocks)
    const resolvedById = new Map<string, DocxDetailedBlock>()
    cachedBlocks.forEach((block) => resolvedById.set(block.blockId, block))
    response.payload.blocks.forEach((block) => resolvedById.set(block.blockId, block))
    return blockIds
      .map((blockId) => resolvedById.get(blockId))
      .filter((block): block is DocxDetailedBlock => Boolean(block))
  }

  const buildReplaySnapshotForDoc = async (
    docId: string,
    session?: DocxReadSession
  ): Promise<DocxReplaySnapshot> => {
    const outlineBlocks = await fetchAllOutlineBlocks({
      session,
      docId,
      includeTables: true,
      includeCells: true
    })
    const detailedBlocks = await fetchDetailedBlocksByIds(
      docId,
      outlineBlocks.map((block) => block.blockId),
      session
    )
    return createReplaySnapshot({
      outlineBlocks,
      detailedBlocksById: new Map(detailedBlocks.map((block) => [block.blockId, block] as const))
    })
  }

  const upgradeReadSessionToReplaySession = async (
    sourcePath: string,
    targetMode: DocxReplaySession['targetMode']
  ): Promise<DocxReplaySession> => {
    const normalizedSourcePath = path.resolve(sourcePath)
    const existingReplay = getReplaySession(normalizedSourcePath)
    if (existingReplay) return existingReplay
    const readSession = getReadSession(normalizedSourcePath)
    if (!readSession) {
      throw new Error(`read session not found for sourcePath: ${normalizedSourcePath}`)
    }
    const snapshot = await buildReplaySnapshotForDoc(readSession.docId, readSession)
    const revisionEntry: DocxRevision = {
      revisionRef: readSession.currentRevisionRef,
      docId: readSession.docId,
      createdAt: Date.now()
    }
    state.revisionEntryByDocId.set(readSession.docId, revisionEntry)
    const session = createReplaySessionFromSnapshot({
      sourcePath: normalizedSourcePath,
      targetMode,
      sourceDocId: readSession.docId,
      meta: readSession.meta,
      stats: readSession.stats,
      snapshot
    })
    session.docIdByRevisionRef = new Map([[readSession.currentRevisionRef, readSession.docId]])
    session.revisionRefByDocId = new Map([[readSession.docId, readSession.currentRevisionRef]])
    session.revisionByDocId = new Map([[readSession.docId, revisionEntry]])
    state.replaySessionBySourcePath.set(normalizedSourcePath, session)
    state.readSessionBySourcePath.delete(normalizedSourcePath)
    return session
  }

  const ensureReadSession = async (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }): Promise<RequireReadSessionResult> => {
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

    const replaySession = getReplaySession(requestedSourcePath)
    if (replaySession) {
      return buildReadSessionResultFromReplay(requestedSourcePath, replaySession)
    }

    const existingReadSession = getReadSession(requestedSourcePath)
    if (existingReadSession) {
      return buildReadSessionResult(requestedSourcePath, existingReadSession)
    }

    try {
      const opened = await openDocumentAsReadSession(requestedSourcePath)
      return buildReadSessionResult(opened.sourcePath, opened)
    } catch (error) {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          code: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  const ensureReplaySession = async (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
    reason?: 'history' | 'edit' | 'rollback'
  }): Promise<RequireReplaySessionResult> => {
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

    const existingReplay = getReplaySession(requestedSourcePath)
    if (existingReplay) {
      return buildReplaySessionResult(requestedSourcePath, existingReplay)
    }

    let readSession = getReadSession(requestedSourcePath)
    if (!readSession) {
      const readResult = await ensureReadSession({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        sourcePath: requestedSourcePath
      })
      if ('failure' in readResult) {
        return readResult
      }
      readSession = readResult.readSession
      if (!readSession) {
        return {
          failure: emitFailure({
            toolName: params.toolName,
            toolCallId: params.toolCallId,
            code: 'failed',
            error: 'cannot upgrade an active replay-backed read context'
          })
        }
      }
    }

    try {
      const replay = await upgradeReadSessionToReplaySession(readSession.sourcePath, 'update')
      input.ctx.trackDocxOpen({
        docId: replay.sourceDocId,
        sourcePath: replay.sourcePath,
        replaySession: replay
      })
      return buildReplaySessionResult(replay.sourcePath, replay)
    } catch (error) {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          code: 'failed',
          error: error instanceof Error ? error.message : String(error),
          resourceContext: {
            family: 'docx',
            sourcePath: requestedSourcePath
          }
        })
      }
    }
  }

  const stringifyBlockSpec = (spec: DocxReplaySnapshot['blocks'][number]['spec']): string => {
    if (spec.kind === 'paragraph') {
      return spec.runs.map((run) => run.text).join('')
    }
    return spec.rows
      .map((row) =>
        row
          .map((cell) =>
            cell.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n')
          )
          .join('\t')
      )
      .join('\n')
  }

  const buildCreatedBlocksFromSnapshot = (snapshot: DocxReplaySnapshot): DocxCreatedBlock[] =>
    snapshot.blocks.flatMap((block) => [
      {
        blockId: block.blockId,
        type: block.kind
      } as const,
      ...block.tableCellBlockIds.map((cellBlockId) => ({
        blockId: cellBlockId,
        type: 'table_cell' as const
      }))
    ])

  const buildInsertedChangedBlocksFromSnapshot = (
    snapshot: DocxReplaySnapshot
  ): DocxRevision['changedBlocks'] =>
    snapshot.blocks.map((block) => ({
      action: 'inserted',
      blockId: block.blockId,
      beforeText: '',
      afterText: stringifyBlockSpec(block.spec)
    }))

  const registerCreatedDocument = async (params: {
    sourcePath: string
    baselineDocId: string
    workingDocId: string
    meta?: DocxOpenMeta
    stats?: DocxOpenStats
    summary?: string
  }) => {
    const normalizedSourcePath = path.resolve(params.sourcePath)
    if (state.replaySessionBySourcePath.has(normalizedSourcePath)) {
      throw new Error(`docx session already exists for sourcePath: ${normalizedSourcePath}`)
    }

    state.readSessionBySourcePath.delete(normalizedSourcePath)
    registerSnapshot(params.baselineDocId)
    state.sourcePathByDocId.set(params.baselineDocId, normalizedSourcePath)
    const baselineRevisionEntry: DocxRevision = {
      revisionRef: 'v1',
      docId: params.baselineDocId,
      createdAt: Date.now()
    }
    state.revisionEntryByDocId.set(params.baselineDocId, baselineRevisionEntry)
    const baselineSnapshot = createEmptyReplaySnapshot()
    const session = createReplaySessionFromSnapshot({
      sourcePath: normalizedSourcePath,
      targetMode: 'create',
      sourceDocId: params.baselineDocId,
      meta: params.meta || {
        title: '',
        creator: '',
        lastModifiedBy: '',
        description: '',
        defaultFont: ''
      },
      stats: params.stats || {
        blockCount: 0,
        paragraphCount: 0,
        tableCount: 0,
        imageCount: 0,
        charCount: 0
      },
      snapshot: baselineSnapshot
    })
    session.revisionByDocId = new Map([[params.baselineDocId, baselineRevisionEntry]])
    state.replaySessionBySourcePath.set(normalizedSourcePath, session)

    const workingSnapshot = await buildReplaySnapshotForDoc(params.workingDocId)
    const createdBlocks = buildCreatedBlocksFromSnapshot(workingSnapshot)
    const changedBlocks = buildInsertedChangedBlocksFromSnapshot(workingSnapshot)
    const revisionUpdate = await registerRevision({
      sourcePath: normalizedSourcePath,
      previousDocId: params.baselineDocId,
      nextDocId: params.workingDocId,
      ops: [{ type: 'create_document' }],
      createdBlocks,
      changedBlocks,
      summary: params.summary
    })

    return {
      session,
      previousRevisionRef: revisionUpdate.previousRevisionRef,
      currentRevisionRef: revisionUpdate.currentRevisionRef,
      changedBlocks,
      createdBlocks
    }
  }

  const registerRevision = async (params: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    ops: DocxOp[]
    createdBlocks: DocxRevision['createdBlocks']
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
    session.docIdByRevisionRef.set(currentRevisionRef, params.nextDocId)
    session.revisionRefByDocId.set(params.nextDocId, currentRevisionRef)
    state.sourcePathByDocId.set(params.nextDocId, sourcePath)
    registerSnapshot(params.nextDocId, params.previousDocId)
    const nextSnapshot = await buildReplaySnapshotForDoc(params.nextDocId)
    const revisionEntry: DocxRevision = {
      revisionRef: currentRevisionRef,
      docId: params.nextDocId,
      parentRevisionRef: previousRevisionRef,
      createdAt: Date.now(),
      changedBlocks: params.changedBlocks,
      summary: params.summary,
      ops: params.ops,
      createdBlocks: params.createdBlocks
    }
    state.revisionEntryByDocId.set(params.nextDocId, revisionEntry)
    session.revisionByDocId.set(params.nextDocId, revisionEntry)
    params.ops.forEach((op) => {
      applyRevisionToReplaySession({
        session,
        revisionRef: currentRevisionRef,
        op,
        createdBlocks: params.createdBlocks || [],
        nextSnapshot
      })
    })
    session.activeDocId = params.nextDocId
    session.activeRevisionRef = currentRevisionRef
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
      const entry = session.revisionByDocId.get(docId)
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
        const entry = docId ? session.revisionByDocId.get(docId) : undefined
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
      const entry = docId ? session.revisionByDocId.get(docId) : undefined
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

  const rebuildReplaySessionAtRevision = async (
    session: DocxReplaySession,
    targetRevisionRef: string
  ): Promise<void> => {
    const targetChain: DocxRevision[] = []
    let cursor = targetRevisionRef

    while (cursor && cursor !== 'v1') {
      const docId = session.docIdByRevisionRef.get(cursor)
      const entry = docId ? session.revisionByDocId.get(docId) : undefined
      if (!entry) break
      targetChain.push(entry)
      cursor = entry.parentRevisionRef || ''
    }

    const baseline = createReplaySessionFromSnapshot({
      sourcePath: session.sourcePath,
      sourceDocId: session.sourceDocId,
      meta: session.meta,
      stats: session.stats,
      snapshot: session.sourceSnapshot
    })
    baseline.docIdByRevisionRef = session.docIdByRevisionRef
    baseline.revisionRefByDocId = session.revisionRefByDocId
    baseline.revisionByDocId = session.revisionByDocId
    baseline.nextRevisionNumber = session.nextRevisionNumber
    baseline.viewArtifacts = session.viewArtifacts

    for (const revision of targetChain.reverse()) {
      if (!revision.ops || revision.ops.length === 0) continue
      const snapshot = await buildReplaySnapshotForDoc(revision.docId)
      revision.ops.forEach((op) => {
        applyRevisionToReplaySession({
          session: baseline,
          revisionRef: revision.revisionRef,
          op,
          createdBlocks: revision.createdBlocks || [],
          nextSnapshot: snapshot
        })
      })
    }

    session.activeSnapshot = baseline.activeSnapshot
    session.nodeById = baseline.nodeById
    session.bodyNodeIds = baseline.bodyNodeIds
  }

  const activateRevision = async (params: {
    sourcePath: string
    targetDocId: string
    targetRevisionRef: string
  }) => {
    const session = state.replaySessionBySourcePath.get(path.resolve(params.sourcePath))
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${params.sourcePath}`)
    }
    const previousRevisionRef = session.activeRevisionRef
    await rebuildReplaySessionAtRevision(session, params.targetRevisionRef)
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

    const outline = await fetchOutlinePage({
      docId,
      fromBodyIndex: 0,
      maxBlocks: 2000,
      includeTables: true,
      includeCells: true
    })

    const searchableBlocks = outline.blocks.filter(isSemanticSearchableBlock)
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
    getReadSession,
    getReplaySession,
    ensureReadSession,
    ensureReplaySession,
    registerCreatedDocument,
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
