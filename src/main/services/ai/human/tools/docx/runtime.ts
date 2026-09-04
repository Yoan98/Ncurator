import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiToolCallResult } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxCreatedNode,
  DocxDetailedNode,
  DocxDiskFingerprint,
  DocxOpenStats,
  DocxOperation,
  DocxOutlineNode,
  DocxReadSession,
  DocxReplaySession,
  DocxReplaySnapshot,
  DocxRevision
} from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest, DocxWorkerResponse } from './worker/types'
import { resolveToolPath } from '../terminal/commandPolicy'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'
import {
  applyRevisionToReplaySession,
  createEmptyReplaySnapshot,
  createReplaySessionFromSnapshot,
  createReplaySnapshot
} from './review/replayTree'
import { isLegacyDocPath, isReadableWordPath } from './legacyDocPolicy'

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

export const buildDocxToolCallResult = (input: {
  toolName: string
  ok: boolean
  data: AiToolCallResult['data']
  resourceContext?: DocxToolResourceContext
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data,
  resourceContext: input.resourceContext
})

export type DocxToolFailure = {
  code: string
  error: string
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
    reason: string
    error: string
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
  callWorker: (
    request: Omit<DocxWorkerRequest, 'requestId' | 'runId'>
  ) => Promise<DocxWorkerResponse>
  resolveDocxPath: (rawPath: string) => string | null
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
    stats?: DocxOpenStats
    persistedStats: DocxDiskFingerprint
    summary?: string
  }) => Promise<{
    session: DocxReplaySession
    previousRevisionRef: string
    currentRevisionRef: string
    changedNodes: DocxRevision['changedNodes']
    createdNodes: DocxRevision['createdNodes']
  }>
  registerRevision: (input: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    ops: DocxOperation[]
    createdNodes: DocxRevision['createdNodes']
    createdNodesByOperation?: NonNullable<DocxRevision['createdNodesByOperation']>
    opNextDocIds?: NonNullable<DocxRevision['opNextDocIds']>
    changedNodes?: DocxRevision['changedNodes']
    persistedStats: DocxDiskFingerprint
    stats?: DocxOpenStats
    summary?: string
  }) => Promise<{ currentRevisionRef: string; previousRevisionRef: string }>
  expandOpsForReview: (docId: string, ops: DocxOperation[]) => Promise<DocxOperation[]>
  cloneActiveReplaySession: (
    sourcePath: string
  ) => { ok: true; session: DocxReplaySession } | { ok: false; error: string }
  buildReplaySnapshotForDoc: (docId: string) => Promise<DocxReplaySnapshot>
  applyTempRevisionToReplaySession: (input: {
    session: DocxReplaySession
    revisionRef: string
    op: DocxOperation
    createdNodes: DocxCreatedNode[]
    nextDocId: string
  }) => Promise<void>
  buildResourceContext: (input: {
    sourcePath: string
    effectKind: DocxToolResourceContext['effectKind']
    currentRevisionRef?: string
    previousRevisionRef?: string
  }) => DocxToolResourceContext
  persistDocId: (input: {
    sourcePath: string
    docId: string
  }) => Promise<{ checksum: string; byteSize: number; modifiedAt: number }>
}

export const createDocxToolRuntime = (input: DocxCapabilityToolsInput): DocxToolRuntime => {
  const readSessionBySourcePath = new Map<string, DocxReadSession>()
  const replaySessionBySourcePath = new Map<string, DocxReplaySession>()
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
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
    reason: string
    error: string
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => ({
    code: params.reason,
    error: params.error,
    resourceContext: params.resourceContext
  })

  const emitFailure = (params: {
    toolName: string
    toolCallId: string
    reason: string
    error: string
    draftDocId?: string
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => {
    const out = toFailure({
      reason: params.reason,
      error: params.error,
      resourceContext: params.resourceContext
    })
    toolEvents.emitResult({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      result: buildDocxToolCallResult({
        toolName: params.toolName,
        ok: false,
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
      reason: params.response.code,
      error: params.response.error,
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

  const resolveReadableWordPath = (rawPath: string): string | null => {
    const resolved = resolveToolPath(rawPath)
    if (!resolved) return null
    if (!isReadableWordPath(resolved)) return null
    return resolved
  }

  const resolveDocxPath = (rawPath: string): string | null => {
    const resolved = resolveReadableWordPath(rawPath)
    if (!resolved || isLegacyDocPath(resolved)) return null
    return resolved
  }

  const getReadSession = (sourcePath: string): DocxReadSession | undefined =>
    state.readSessionBySourcePath.get(path.resolve(sourcePath))

  const getReplaySession = (sourcePath: string): DocxReplaySession | undefined =>
    state.replaySessionBySourcePath.get(path.resolve(sourcePath))

  const isSessionFresh = async (
    sourcePath: string,
    fingerprint: DocxDiskFingerprint
  ): Promise<boolean> => {
    try {
      const stat = await fs.stat(sourcePath)
      const modifiedAt = Math.trunc(stat.mtimeMs)
      if (stat.size === fingerprint.byteSize && modifiedAt === fingerprint.modifiedAt) return true
      const buffer = await fs.readFile(sourcePath)
      const checksum = createHash('sha256').update(buffer).digest('hex')
      if (checksum !== fingerprint.checksum) return false
      fingerprint.byteSize = buffer.byteLength
      fingerprint.modifiedAt = modifiedAt
      return true
    } catch {
      return false
    }
  }

  const externalChangeFailure = (inputValue: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }): DocxToolFailure => {
    const sourcePath = path.resolve(inputValue.sourcePath)
    state.readSessionBySourcePath.delete(sourcePath)
    state.replaySessionBySourcePath.delete(sourcePath)
    return emitFailure({
      toolName: inputValue.toolName,
      toolCallId: inputValue.toolCallId,
      reason: 'document_changed_externally',
      error: 'document changed outside the active docx session; read the document again',
      resourceContext: { family: 'docx', sourcePath }
    })
  }

  const createReadSessionCache = (): DocxReadSession['cache'] => ({
    outlineByCacheKey: new Map(),
    detailByNodeId: new Map()
  })

  const cacheOutline = (
    session: DocxReadSession | undefined,
    key: string,
    value: { nodes: DocxOutlineNode[] }
  ) => {
    if (!session) return
    session.cache.outlineByCacheKey.set(key, value)
  }

  const cacheDetailedNodes = (
    session: DocxReadSession | undefined,
    nodes: readonly DocxDetailedNode[]
  ) => {
    if (!session) return
    nodes.forEach((node) => {
      session.cache.detailByNodeId.set(node.nodeId, node)
    })
  }

  const buildOpenStatsFromReplaySnapshot = (snapshot: DocxReplaySnapshot): DocxOpenStats => ({
    rootNodeCount: snapshot.nodes.length
  })

  const syncReplaySessionStats = (session: DocxReplaySession): void => {
    session.stats = buildOpenStatsFromReplaySnapshot(session.activeSnapshot)
  }

  const buildReadSessionResultFromReplay = (
    sourcePath: string,
    session: DocxReplaySession
  ): Exclude<RequireReadSessionResult, { failure: DocxToolFailure }> => {
    syncReplaySessionStats(session)
    return {
      sourcePath,
      docId: session.activeDocId,
      currentRevisionRef: session.activeRevisionRef,
      stats: session.stats,
      replaySession: session
    }
  }

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
    stats: session.stats,
    readSession: session
  })

  const openDocumentAsReadSession = async (sourcePath: string): Promise<DocxReadSession> => {
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
    const openedStat = await fs.stat(resolvedTarget.openPath)
    state.sourcePathByDocId.set(workerResponse.payload.docId, normalizedSourcePath)
    const session: DocxReadSession = {
      sourcePath: normalizedSourcePath,
      docId: workerResponse.payload.docId,
      stats: workerResponse.payload.stats,
      currentRevisionRef: 'v1',
      diskFingerprint: {
        checksum: workerResponse.payload.checksum,
        byteSize: workerResponse.payload.byteSize,
        modifiedAt: Math.trunc(openedStat.mtimeMs)
      },
      cache: createReadSessionCache()
    }
    state.readSessionBySourcePath.set(normalizedSourcePath, session)
    input.ctx.trackDocxOpen({
      docId: workerResponse.payload.docId,
      sourcePath: normalizedSourcePath
    })
    return session
  }

  const fetchOutlineNodes = async (inputValue: {
    session?: DocxReadSession
    docId: string
    fromNodeIndex: number
    toNodeIndex: number
    includeCells: boolean
  }): Promise<DocxOutlineNode[]> => {
    const cacheKey = JSON.stringify({
      fromNodeIndex: inputValue.fromNodeIndex,
      toNodeIndex: inputValue.toNodeIndex,
      includeCells: inputValue.includeCells
    })
    const cached = inputValue.session?.cache.outlineByCacheKey.get(cacheKey)
    if (cached) {
      return cached.nodes
    }
    const outlineResponse = await callWorker({
      action: 'outline',
      payload: {
        docId: inputValue.docId,
        fromNodeIndex: inputValue.fromNodeIndex,
        toNodeIndex: inputValue.toNodeIndex,
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
      nodes: outlineResponse.payload.nodes
    }
    cacheOutline(inputValue.session || undefined, cacheKey, result)
    return result.nodes
  }

  const fetchDetailedNodesByIds = async (
    docId: string,
    nodeIds: string[],
    session?: DocxReadSession
  ): Promise<DocxDetailedNode[]> => {
    const cachedNodes: DocxDetailedNode[] = []
    const missingNodeIds: string[] = []
    nodeIds.forEach((nodeId) => {
      const cached = session?.cache.detailByNodeId.get(nodeId)
      if (cached) {
        cachedNodes.push(cached)
      } else {
        missingNodeIds.push(nodeId)
      }
    })
    if (missingNodeIds.length === 0) {
      return cachedNodes
    }
    const response = await callWorker({
      action: 'get_nodes_by_ids',
      payload: {
        docId,
        nodeIds: missingNodeIds
      }
    })
    if (!response.ok) {
      throw new Error(response.error)
    }
    if (response.payload.action !== 'get_nodes_by_ids') {
      throw new Error('worker protocol mismatch (get_nodes_by_ids)')
    }
    cacheDetailedNodes(session, response.payload.nodes)
    const resolvedById = new Map<string, DocxDetailedNode>()
    cachedNodes.forEach((node) => resolvedById.set(node.nodeId, node))
    response.payload.nodes.forEach((node) => resolvedById.set(node.nodeId, node))
    return nodeIds
      .map((nodeId) => resolvedById.get(nodeId))
      .filter((node): node is DocxDetailedNode => Boolean(node))
  }

  const buildReplaySnapshotForDoc = async (
    docId: string,
    session?: DocxReadSession
  ): Promise<DocxReplaySnapshot> => {
    const outlineNodes = await fetchOutlineNodes({
      session,
      docId,
      fromNodeIndex: 0,
      toNodeIndex: Number.MAX_SAFE_INTEGER,
      includeCells: true
    })
    const detailedNodes = await fetchDetailedNodesByIds(
      docId,
      outlineNodes.map((node) => node.nodeId),
      session
    )
    const rawXmlResponse = await callWorker({
      action: 'get_replay_snapshot_xml',
      payload: { docId }
    })
    if (!rawXmlResponse.ok) throw new Error(rawXmlResponse.error)
    if (rawXmlResponse.payload.action !== 'get_replay_snapshot_xml') {
      throw new Error('worker protocol mismatch (get_replay_snapshot_xml)')
    }
    return createReplaySnapshot({
      packageFingerprint: rawXmlResponse.payload.packageFingerprint,
      outlineNodes,
      detailedNodesById: new Map(detailedNodes.map((node) => [node.nodeId, node] as const)),
      rawXmlByNodeId: new Map(
        rawXmlResponse.payload.nodes.map((node) => [node.nodeId, node.rawXml] as const)
      )
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
    const session = createReplaySessionFromSnapshot({
      sourcePath: normalizedSourcePath,
      targetMode,
      sourceDocId: readSession.docId,
      stats: readSession.stats,
      diskFingerprint: readSession.diskFingerprint,
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
    const requestedSourcePath = resolveReadableWordPath(params.sourcePath)
    if (!requestedSourcePath) {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          reason: 'invalid_input',
          error: 'sourcePath must be a .doc or .docx path'
        })
      }
    }

    const replaySession = getReplaySession(requestedSourcePath)
    if (replaySession) {
      if (!(await isSessionFresh(requestedSourcePath, replaySession.diskFingerprint))) {
        return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
      }
      return buildReadSessionResultFromReplay(requestedSourcePath, replaySession)
    }

    const existingReadSession = getReadSession(requestedSourcePath)
    if (existingReadSession) {
      if (!(await isSessionFresh(requestedSourcePath, existingReadSession.diskFingerprint))) {
        return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
      }
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
          reason: 'failed',
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
    const requestedSourcePath = resolveDocxPath(params.sourcePath)
    if (!requestedSourcePath) {
      return {
        failure: emitFailure({
          toolName: params.toolName,
          toolCallId: params.toolCallId,
          reason: 'invalid_input',
          error: 'sourcePath must be a .docx path'
        })
      }
    }

    const existingReplay = getReplaySession(requestedSourcePath)
    if (existingReplay) {
      if (!(await isSessionFresh(requestedSourcePath, existingReplay.diskFingerprint))) {
        return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
      }
      return buildReplaySessionResult(requestedSourcePath, existingReplay)
    }

    let readSession = getReadSession(requestedSourcePath)
    if (readSession && !(await isSessionFresh(requestedSourcePath, readSession.diskFingerprint))) {
      return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
    }
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
            reason: 'failed',
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
          reason: 'failed',
          error: error instanceof Error ? error.message : String(error),
          resourceContext: {
            family: 'docx',
            sourcePath: requestedSourcePath
          }
        })
      }
    }
  }

  const stringifyNodeSpec = (spec: DocxReplaySnapshot['nodes'][number]['spec']): string => {
    if (spec.kind === 'paragraph') {
      return spec.runs.map((run) => run.text).join('')
    }
    return spec.rows
      .map((row) =>
        row
          .map((cell) =>
            cell.paragraphs
              .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
              .join('\n')
          )
          .join('\t')
      )
      .join('\n')
  }

  const buildCreatedNodesFromSnapshot = (snapshot: DocxReplaySnapshot): DocxCreatedNode[] =>
    snapshot.nodes.flatMap((node) => [
      {
        nodeId: node.nodeId,
        type: node.kind
      } as const,
      ...node.tableCellNodeIds.map((cellNodeId) => ({
        nodeId: cellNodeId,
        type: 'table_cell' as const
      }))
    ])

  const buildInsertedChangedNodesFromSnapshot = (
    snapshot: DocxReplaySnapshot
  ): DocxRevision['changedNodes'] =>
    snapshot.nodes.map((node) => ({
      action: 'inserted',
      nodeId: node.nodeId,
      beforeText: '',
      afterText: stringifyNodeSpec(node.spec)
    }))

  const registerCreatedDocument = async (params: {
    sourcePath: string
    baselineDocId: string
    workingDocId: string
    stats?: DocxOpenStats
    persistedStats: DocxDiskFingerprint
    summary?: string
  }) => {
    const normalizedSourcePath = path.resolve(params.sourcePath)
    if (state.replaySessionBySourcePath.has(normalizedSourcePath)) {
      throw new Error(`docx session already exists for sourcePath: ${normalizedSourcePath}`)
    }

    state.readSessionBySourcePath.delete(normalizedSourcePath)
    state.sourcePathByDocId.set(params.baselineDocId, normalizedSourcePath)
    const baselineRevisionEntry: DocxRevision = {
      revisionRef: 'v1',
      docId: params.baselineDocId,
      createdAt: Date.now()
    }
    const baselineSnapshot = createEmptyReplaySnapshot()
    const session = createReplaySessionFromSnapshot({
      sourcePath: normalizedSourcePath,
      targetMode: 'create',
      sourceDocId: params.baselineDocId,
      stats: params.stats || { rootNodeCount: 0 },
      diskFingerprint: params.persistedStats,
      snapshot: baselineSnapshot
    })
    session.revisionByDocId = new Map([[params.baselineDocId, baselineRevisionEntry]])
    state.replaySessionBySourcePath.set(normalizedSourcePath, session)

    const workingSnapshot = await buildReplaySnapshotForDoc(params.workingDocId)
    const createdNodes = buildCreatedNodesFromSnapshot(workingSnapshot)
    const changedNodes = buildInsertedChangedNodesFromSnapshot(workingSnapshot)
    const revisionUpdate = await registerRevision({
      sourcePath: normalizedSourcePath,
      previousDocId: params.baselineDocId,
      nextDocId: params.workingDocId,
      ops: [{ type: 'create_document' }],
      createdNodes,
      changedNodes,
      persistedStats: params.persistedStats,
      summary: params.summary
    })

    return {
      session,
      previousRevisionRef: revisionUpdate.previousRevisionRef,
      currentRevisionRef: revisionUpdate.currentRevisionRef,
      changedNodes,
      createdNodes
    }
  }

  const registerRevision = async (params: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    ops: DocxOperation[]
    createdNodes: DocxRevision['createdNodes']
    createdNodesByOperation?: NonNullable<DocxRevision['createdNodesByOperation']>
    opNextDocIds?: NonNullable<DocxRevision['opNextDocIds']>
    changedNodes?: DocxRevision['changedNodes']
    persistedStats: DocxDiskFingerprint
    stats?: DocxOpenStats
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
    const nextSnapshot = await buildReplaySnapshotForDoc(params.nextDocId)
    const revisionEntry: DocxRevision = {
      revisionRef: currentRevisionRef,
      docId: params.nextDocId,
      parentRevisionRef: previousRevisionRef,
      createdAt: Date.now(),
      changedNodes: params.changedNodes,
      summary: params.summary,
      ops: params.ops,
      createdNodes: params.createdNodes,
      createdNodesByOperation: params.createdNodesByOperation,
      opNextDocIds: params.opNextDocIds
    }
    session.revisionByDocId.set(params.nextDocId, revisionEntry)
    for (const [opIndex, op] of params.ops.entries()) {
      const opNextDocId = params.opNextDocIds?.[opIndex]
      const opSnapshot =
        opNextDocId && opNextDocId !== params.nextDocId
          ? await buildReplaySnapshotForDoc(opNextDocId)
          : nextSnapshot
      applyRevisionToReplaySession({
        session,
        revisionRef: currentRevisionRef,
        op,
        createdNodes: params.createdNodesByOperation?.[opIndex] || params.createdNodes || [],
        nextSnapshot: opSnapshot
      })
    }
    session.activeDocId = params.nextDocId
    session.activeRevisionRef = currentRevisionRef
    session.diskFingerprint = params.persistedStats
    if (params.stats) session.stats = params.stats
    else syncReplaySessionStats(session)
    return {
      currentRevisionRef,
      previousRevisionRef
    }
  }

  const cloneActiveReplaySession = (
    sourcePath: string
  ): { ok: true; session: DocxReplaySession } | { ok: false; error: string } => {
    const source = state.replaySessionBySourcePath.get(path.resolve(sourcePath))
    if (!source) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(sourcePath)}`
      }
    }
    const clone: DocxReplaySession = {
      ...source,
      docIdByRevisionRef: new Map(source.docIdByRevisionRef),
      revisionRefByDocId: new Map(source.revisionRefByDocId),
      revisionByDocId: new Map(source.revisionByDocId),
      nodeById: new Map(
        [...source.nodeById.entries()].map(([nodeId, node]) => [nodeId, { ...node }] as const)
      ),
      rootNodeIds: [...source.rootNodeIds]
    }
    return {
      ok: true,
      session: clone
    }
  }

  const applyTempRevisionToReplaySession = async (params: {
    session: DocxReplaySession
    revisionRef: string
    op: DocxOperation
    createdNodes: DocxCreatedNode[]
    nextDocId: string
  }): Promise<void> => {
    const nextSnapshot = await buildReplaySnapshotForDoc(params.nextDocId)
    applyRevisionToReplaySession({
      session: params.session,
      revisionRef: params.revisionRef,
      op: params.op,
      createdNodes: params.createdNodes,
      nextSnapshot
    })
    params.session.activeDocId = params.nextDocId
    params.session.activeRevisionRef = params.revisionRef
  }

  const expandOpsForReview = async (
    docId: string,
    ops: DocxOperation[]
  ): Promise<DocxOperation[]> =>
    await Promise.all(
      ops.map(async (op) => {
        if (op.type !== 'format_text') return op
        const response = await callWorker({
          action: 'get_node_layout',
          payload: { docId, nodeId: op.nodeId }
        })
        if (!response.ok) throw new Error(response.error)
        if (response.payload.action !== 'get_node_layout') {
          throw new Error('worker protocol mismatch (get_node_layout)')
        }
        return { ...op, nodeId: response.payload.ownerNodeId }
      })
    )

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

  const persistDocId = async (inputValue: {
    sourcePath: string
    docId: string
  }): Promise<{ checksum: string; byteSize: number; modifiedAt: number }> => {
    const sourcePath = path.resolve(inputValue.sourcePath)
    await fs.mkdir(path.dirname(sourcePath), { recursive: true })
    const tempPath = path.join(
      path.dirname(sourcePath),
      `.${path.basename(sourcePath)}.ncurator-${randomUUID()}.tmp`
    )
    const backupPath = `${tempPath}.previous`
    let hasBackup = false
    let preserveBackup = false
    try {
      const materialized = await callWorker({
        action: 'materialize_draft',
        payload: { docId: inputValue.docId, outPath: tempPath }
      })
      if (!materialized.ok) throw new Error(materialized.error)
      if (materialized.payload.action !== 'materialize_draft') {
        throw new Error('worker protocol mismatch (materialize_draft)')
      }

      try {
        await fs.copyFile(sourcePath, backupPath)
        hasBackup = true
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }

      try {
        await fs.rename(tempPath, sourcePath)
      } catch {
        await fs.rm(sourcePath, { force: true })
        await fs.rename(tempPath, sourcePath)
      }

      const [buffer, stat] = await Promise.all([fs.readFile(sourcePath), fs.stat(sourcePath)])
      const checksum = createHash('sha256').update(buffer).digest('hex')
      if (checksum !== materialized.payload.checksum) {
        throw new Error('post-write checksum mismatch')
      }
      if (hasBackup) {
        await fs.rm(backupPath, { force: true })
        hasBackup = false
      }
      return {
        checksum,
        byteSize: buffer.byteLength,
        modifiedAt: Math.trunc(stat.mtimeMs)
      }
    } catch (error) {
      if (hasBackup) {
        try {
          await fs.rm(sourcePath, { force: true })
          await fs.rename(backupPath, sourcePath)
          hasBackup = false
        } catch {
          // Preserve the original error. The backup remains beside the target for recovery.
          preserveBackup = true
        }
      }
      throw error
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      if (hasBackup && !preserveBackup) {
        await fs.rm(backupPath, { force: true }).catch(() => undefined)
      }
    }
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
    getReadSession,
    getReplaySession,
    ensureReadSession,
    ensureReplaySession,
    registerCreatedDocument,
    registerRevision,
    expandOpsForReview,
    cloneActiveReplaySession,
    buildReplaySnapshotForDoc,
    applyTempRevisionToReplaySession,
    buildResourceContext,
    persistDocId
  }
}
