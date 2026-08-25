import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiToolCallResult, JsonObject } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxCreatedNode,
  DocxDetailedNode,
  DocxDiskFingerprint,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOperation,
  DocxOutlineNode,
  DocxReadSession,
  DocxReplayNode,
  DocxReplaySession,
  DocxReplaySnapshot,
  DocxRevision,
  DocxStableLocator,
  DocxSnapshotResolvedToolCall,
  SemanticDocIndex
} from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest, DocxWorkerResponse } from './worker/types'
import { resolveToolPath } from '../terminal/commandPolicy'
import { isSemanticSearchableNode, splitEmbeddingRows } from './semanticSearch'
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
  ok: false
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
    meta?: DocxOpenMeta
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
  buildSemanticDocIndex: (docId: string) => Promise<SemanticDocIndex>
  getRevisionRefByDocId: (docId: string) => string | undefined
  resolveSnapshotTargets: (input: {
    sourcePath: string
    baseRevisionRef: string
    toolCalls: Array<{ toolName: string; args: JsonObject }>
  }) => Promise<
    | {
        ok: true
        sourcePath: string
        baseRevisionRef: string
        resolvedCalls: DocxSnapshotResolvedToolCall[]
      }
    | { ok: false; error: string }
  >
  resolveCurrentNodeIdFromNodeId: (input: {
    sourcePath: string
    nodeId: string
    allowDeleted?: boolean
  }) => { ok: true; nodeId: string } | { ok: false; error: string }
  resolveLiveNodeIdsFromStableLocators: (input: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }) => { ok: true; nodeIds: string[] } | { ok: false; error: string }
  resolveCurrentStableLocatorsFromSnapshot: (input: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    nodeIds: string[]
  }) => { ok: true; stableLocators: DocxStableLocator[] } | { ok: false; error: string }
  resolveLiveNodeIdsFromStableLocatorsInSession: (input: {
    session: DocxReplaySession
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }) => { ok: true; nodeIds: string[] } | { ok: false; error: string }
  resolveCurrentNodeIdsFromSnapshot: (input: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    nodeIds: string[]
    allowDeleted?: boolean
  }) => { ok: true; nodeIds: string[] } | { ok: false; error: string }
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
    reason: string
    error: string
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => ({
    ok: false,
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

  const getRevisionRefByDocId = (docId: string): string | undefined =>
    state.revisionEntryByDocId.get(docId)?.revisionRef

  const cloneReplaySessionAtRevision = async (inputValue: {
    sourcePath: string
    revisionRef: string
  }): Promise<DocxReplaySession> => {
    const sourcePath = path.resolve(inputValue.sourcePath)
    const session = state.replaySessionBySourcePath.get(sourcePath)
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${sourcePath}`)
    }
    if (inputValue.revisionRef === session.activeRevisionRef) {
      return session
    }

    const clone = createReplaySessionFromSnapshot({
      sourcePath: session.sourcePath,
      targetMode: session.targetMode,
      sourceDocId: session.sourceDocId,
      meta: session.meta,
      stats: session.stats,
      diskFingerprint: session.diskFingerprint,
      snapshot: session.sourceSnapshot
    })
    clone.docIdByRevisionRef = session.docIdByRevisionRef
    clone.revisionRefByDocId = session.revisionRefByDocId
    clone.revisionByDocId = session.revisionByDocId
    clone.nextRevisionNumber = session.nextRevisionNumber

    const targetChain: DocxRevision[] = []
    let cursor = inputValue.revisionRef
    while (cursor && cursor !== 'v1') {
      const docId = clone.docIdByRevisionRef.get(cursor)
      const entry = docId ? clone.revisionByDocId.get(docId) : undefined
      if (!entry) break
      targetChain.push(entry)
      cursor = entry.parentRevisionRef || ''
    }

    for (const revision of targetChain.reverse()) {
      if (!revision.ops || revision.ops.length === 0) continue
      const snapshot = await buildReplaySnapshotForDoc(revision.docId)
      for (const [opIndex, op] of revision.ops.entries()) {
        const opNextDocId = revision.opNextDocIds?.[opIndex]
        const opSnapshot =
          opNextDocId && opNextDocId !== revision.docId
            ? await buildReplaySnapshotForDoc(opNextDocId)
            : snapshot
        applyRevisionToReplaySession({
          session: clone,
          revisionRef: revision.revisionRef,
          op,
          createdNodes: revision.createdNodesByOperation?.[opIndex] || revision.createdNodes || [],
          nextSnapshot: opSnapshot
        })
      }
    }

    const activeDocId = clone.docIdByRevisionRef.get(inputValue.revisionRef)
    if (!activeDocId) {
      throw new Error(`revision not tracked in docx session: ${inputValue.revisionRef}`)
    }
    clone.activeDocId = activeDocId
    clone.activeRevisionRef = inputValue.revisionRef
    return clone
  }

  const findVisibleNodeByLocator = (
    session: DocxReplaySession,
    nodeId: string
  ): DocxReplayNode | undefined =>
    session.rootNodeIds
      .map((nodeId) => session.nodeById.get(nodeId))
      .find((node): node is DocxReplayNode =>
        Boolean(
          node &&
          node.reviewState !== 'deleted' &&
          node.reviewState !== 'replaced-old' &&
          (node.currentNodeId === nodeId || node.nodeId === nodeId || node.sourceNodeId === nodeId)
        )
      )

  const listVisibleNodes = (session: DocxReplaySession): DocxReplayNode[] =>
    session.rootNodeIds
      .map((nodeId) => session.nodeById.get(nodeId))
      .filter((node): node is DocxReplayNode =>
        Boolean(node && node.reviewState !== 'deleted' && node.reviewState !== 'replaced-old')
      )

  const buildContentFingerprint = (node: DocxReplayNode): string => JSON.stringify(node.spec)

  const buildStableLocatorForNode = (input: {
    session: DocxReplaySession
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    node: DocxReplayNode
    requestedNodeId: string
    tableNodeIdOverride?: string
  }): DocxStableLocator => {
    const visibleNodes = listVisibleNodes(input.session)
    const visibleIndex = visibleNodes.findIndex((node) => node.nodeId === input.node.nodeId)
    const previousVisibleNodeId =
      visibleIndex > 0 ? visibleNodes[visibleIndex - 1]?.nodeId : undefined
    const nextVisibleNodeId =
      visibleIndex >= 0 && visibleIndex < visibleNodes.length - 1
        ? visibleNodes[visibleIndex + 1]?.nodeId
        : undefined
    const tableNodeId =
      input.tableNodeIdOverride ||
      input.session.activeSnapshot.tableNodeIdByCellNodeId.get(input.requestedNodeId)
    const tableNode = tableNodeId ? findVisibleNodeByLocator(input.session, tableNodeId) : undefined
    const tableSnapshotNode = tableNodeId
      ? input.session.activeSnapshot.nodeById.get(tableNodeId)
      : undefined
    const tableCellMeta = tableNodeId
      ? tableSnapshotNode?.tableCells?.find((cell) => cell.nodeId === input.requestedNodeId)
      : undefined
    return {
      nodeId: input.node.nodeId,
      sourceNodeId: input.node.sourceNodeId,
      currentNodeIdAtResolve:
        input.node.currentNodeId || input.node.nodeId || input.node.sourceNodeId,
      nodeIndexAtResolve: input.node.nodeIndex,
      previousVisibleNodeId,
      nextVisibleNodeId,
      kind: tableNodeId ? 'table_cell' : input.node.kind,
      contentFingerprint: buildContentFingerprint(input.node),
      tableNodeId: tableNode?.nodeId,
      tableSourceNodeId: tableNode?.sourceNodeId,
      tableFingerprint: tableNode ? buildContentFingerprint(tableNode) : undefined,
      cellNodeId: tableNodeId ? input.requestedNodeId : undefined,
      rowIndex: tableCellMeta?.row,
      colIndex: tableCellMeta?.col,
      cellContentFingerprint: tableCellMeta?.text
    }
  }

  const resolveNodeIdsForLocatorField = (inputValue: {
    session: DocxReplaySession
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    rawValue: JsonObject[string]
  }): DocxStableLocator[] => {
    const nodeIds =
      inputValue.field === 'nodeIds'
        ? Array.isArray(inputValue.rawValue)
          ? inputValue.rawValue.filter(
              (value): value is string => typeof value === 'string' && value.length > 0
            )
          : []
        : typeof inputValue.rawValue === 'string' && inputValue.rawValue.length > 0
          ? [inputValue.rawValue]
          : []
    return nodeIds.map((nodeId) => {
      const tableNodeId = inputValue.session.activeSnapshot.tableNodeIdByCellNodeId.get(nodeId)
      if (tableNodeId) {
        const tableNode = findVisibleNodeByLocator(inputValue.session, tableNodeId)
        if (!tableNode) {
          throw new Error(`cannot resolve table for ${inputValue.field}=${nodeId} in base revision`)
        }
        return buildStableLocatorForNode({
          session: inputValue.session,
          field: inputValue.field,
          node: tableNode,
          requestedNodeId: nodeId,
          tableNodeIdOverride: tableNodeId
        })
      }

      const node = findVisibleNodeByLocator(inputValue.session, nodeId)
      if (!node) {
        throw new Error(`cannot resolve ${inputValue.field}=${nodeId} in base revision`)
      }
      return buildStableLocatorForNode({
        session: inputValue.session,
        field: inputValue.field,
        node,
        requestedNodeId: nodeId
      })
    })
  }

  const resolveSnapshotTargets = async (inputValue: {
    sourcePath: string
    baseRevisionRef: string
    toolCalls: Array<{ toolName: string; args: JsonObject }>
  }): Promise<
    | {
        ok: true
        sourcePath: string
        baseRevisionRef: string
        resolvedCalls: DocxSnapshotResolvedToolCall[]
      }
    | { ok: false; error: string }
  > => {
    try {
      const session = await cloneReplaySessionAtRevision({
        sourcePath: inputValue.sourcePath,
        revisionRef: inputValue.baseRevisionRef
      })
      const resolvedCalls = inputValue.toolCalls.map((toolCall) => {
        const locators: DocxSnapshotResolvedToolCall['locators'] = []
        ;(['nodeId', 'anchorNodeId', 'cellNodeId', 'nodeIds'] as const).forEach((field) => {
          if (!(field in toolCall.args)) return
          locators.push({
            field,
            stableLocators: resolveNodeIdsForLocatorField({
              session,
              field,
              rawValue: toolCall.args[field]
            })
          })
        })
        return {
          toolName: toolCall.toolName,
          sourcePath: path.resolve(inputValue.sourcePath),
          locators
        }
      })
      return {
        ok: true,
        sourcePath: path.resolve(inputValue.sourcePath),
        baseRevisionRef: inputValue.baseRevisionRef,
        resolvedCalls
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const resolveCurrentNodeIdFromNodeId = (inputValue: {
    sourcePath: string
    nodeId: string
    allowDeleted?: boolean
  }): { ok: true; nodeId: string } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }
    const node = session.nodeById.get(inputValue.nodeId)
    if (!node) {
      return {
        ok: false,
        error: `resolved node no longer exists: ${inputValue.nodeId}`
      }
    }
    if (
      !inputValue.allowDeleted &&
      (node.reviewState === 'deleted' || node.reviewState === 'replaced-old')
    ) {
      return {
        ok: false,
        error: `resolved node has already been removed by an earlier operation: ${inputValue.nodeId}`
      }
    }
    const currentNodeId = node.currentNodeId || node.nodeId || node.sourceNodeId
    if (!currentNodeId) {
      return {
        ok: false,
        error: `resolved node has no current node binding: ${inputValue.nodeId}`
      }
    }
    return {
      ok: true,
      nodeId: currentNodeId
    }
  }

  const findVisibleNodeById = (
    session: DocxReplaySession,
    nodeId: string | undefined
  ): DocxReplayNode | undefined => {
    if (!nodeId) return undefined
    const node = session.nodeById.get(nodeId)
    if (!node) return undefined
    if (node.reviewState === 'deleted' || node.reviewState === 'replaced-old') return undefined
    return node
  }

  const findVisibleNodeBySourceNodeId = (
    session: DocxReplaySession,
    sourceNodeId: string | undefined
  ): DocxReplayNode[] => {
    if (!sourceNodeId) return []
    return listVisibleNodes(session).filter((node) => node.sourceNodeId === sourceNodeId)
  }

  const resolveVisibleCellByTableCoordinates = (input: {
    session: DocxReplaySession
    locator: DocxStableLocator
  }): string | undefined => {
    if (typeof input.locator.rowIndex !== 'number' || typeof input.locator.colIndex !== 'number') {
      return undefined
    }
    const tableNode =
      findVisibleNodeById(input.session, input.locator.tableNodeId) ||
      findVisibleNodeBySourceNodeId(input.session, input.locator.tableSourceNodeId)[0]
    if (!tableNode) return undefined
    const tableNodeId = tableNode.currentNodeId || tableNode.nodeId || tableNode.sourceNodeId
    if (!tableNodeId) return undefined
    const snapshotNode = input.session.activeSnapshot.nodeById.get(tableNodeId)
    const matchedCell = snapshotNode?.tableCells?.find(
      (cell) => cell.row === input.locator.rowIndex && cell.col === input.locator.colIndex
    )
    return matchedCell?.nodeId
  }

  const resolveLiveNodeIdsFromStableLocators = (inputValue: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }): { ok: true; nodeIds: string[] } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }

    const resolvedNodeIds: string[] = []
    for (const locator of inputValue.stableLocators) {
      if (inputValue.field === 'cellNodeId') {
        const visibleCellNodeId = resolveVisibleCellByTableCoordinates({
          session,
          locator
        })
        if (visibleCellNodeId) {
          resolvedNodeIds.push(visibleCellNodeId)
          continue
        }
      }

      const visibleNode = findVisibleNodeById(session, locator.nodeId)
      if (visibleNode) {
        const nodeId = visibleNode.currentNodeId || visibleNode.nodeId || visibleNode.sourceNodeId
        if (!nodeId) {
          return {
            ok: false,
            error: `resolved node has no current node binding: ${locator.nodeId}`
          }
        }
        resolvedNodeIds.push(nodeId)
        continue
      }

      const historicalNode = session.nodeById.get(locator.nodeId)
      if (historicalNode?.successorNodeId) {
        const successor = findVisibleNodeById(session, historicalNode.successorNodeId)
        if (inputValue.field === 'cellNodeId') {
          const successorCellNodeId = resolveVisibleCellByTableCoordinates({
            session,
            locator
          })
          if (successorCellNodeId) {
            resolvedNodeIds.push(successorCellNodeId)
            continue
          }
        }
        const successorNodeId =
          successor?.currentNodeId || successor?.nodeId || successor?.sourceNodeId
        if (successorNodeId) {
          resolvedNodeIds.push(successorNodeId)
          continue
        }
      }

      const sourceMatches = findVisibleNodeBySourceNodeId(session, locator.sourceNodeId)
      if (sourceMatches.length === 1) {
        const nodeId =
          sourceMatches[0].currentNodeId || sourceMatches[0].nodeId || sourceMatches[0].sourceNodeId
        if (!nodeId) {
          return {
            ok: false,
            error: `resolved node has no current node binding: ${locator.nodeId}`
          }
        }
        resolvedNodeIds.push(nodeId)
        continue
      }

      if (inputValue.field === 'cellNodeId' || locator.kind === 'table_cell') {
        const recoveredCellNodeId = resolveVisibleCellByTableCoordinates({
          session,
          locator
        })
        if (recoveredCellNodeId) {
          resolvedNodeIds.push(recoveredCellNodeId)
          continue
        }
      }

      const previousVisible = findVisibleNodeById(session, locator.previousVisibleNodeId)
      const nextVisible = findVisibleNodeById(session, locator.nextVisibleNodeId)
      if (inputValue.field === 'anchorNodeId') {
        const neighbor = previousVisible || nextVisible
        const nodeId = neighbor?.currentNodeId || neighbor?.nodeId || neighbor?.sourceNodeId
        if (nodeId) {
          resolvedNodeIds.push(nodeId)
          continue
        }
      }

      return {
        ok: false,
        error:
          inputValue.field === 'anchorNodeId'
            ? `cannot safely resolve anchor after earlier mutations: ${locator.nodeId}`
            : `cannot safely resolve target after earlier mutations: ${locator.nodeId}`
      }
    }

    return {
      ok: true,
      nodeIds: resolvedNodeIds
    }
  }

  const resolveCurrentStableLocatorsFromSnapshot = (inputValue: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    nodeIds: string[]
  }): { ok: true; stableLocators: DocxStableLocator[] } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }
    try {
      return {
        ok: true,
        stableLocators: resolveNodeIdsForLocatorField({
          session,
          field: inputValue.field,
          rawValue: inputValue.field === 'nodeIds' ? inputValue.nodeIds : inputValue.nodeIds[0]
        })
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const resolveLiveNodeIdsFromStableLocatorsInSession = (inputValue: {
    session: DocxReplaySession
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }): { ok: true; nodeIds: string[] } | { ok: false; error: string } => {
    const resolvedNodeIds: string[] = []
    for (const locator of inputValue.stableLocators) {
      if (inputValue.field === 'cellNodeId' || locator.kind === 'table_cell') {
        const visibleCellNodeId = resolveVisibleCellByTableCoordinates({
          session: inputValue.session,
          locator
        })
        if (visibleCellNodeId) {
          resolvedNodeIds.push(visibleCellNodeId)
          continue
        }
      }

      const visibleNode = findVisibleNodeById(inputValue.session, locator.nodeId)
      if (visibleNode) {
        const nodeId = visibleNode.currentNodeId || visibleNode.nodeId || visibleNode.sourceNodeId
        if (!nodeId) {
          return {
            ok: false,
            error: `resolved node has no current node binding: ${locator.nodeId}`
          }
        }
        resolvedNodeIds.push(nodeId)
        continue
      }

      const historicalNode = inputValue.session.nodeById.get(locator.nodeId)
      if (historicalNode?.successorNodeId) {
        if (inputValue.field === 'cellNodeId' || locator.kind === 'table_cell') {
          const successorCellNodeId = resolveVisibleCellByTableCoordinates({
            session: inputValue.session,
            locator
          })
          if (successorCellNodeId) {
            resolvedNodeIds.push(successorCellNodeId)
            continue
          }
        }
        const successor = findVisibleNodeById(inputValue.session, historicalNode.successorNodeId)
        const successorNodeId =
          successor?.currentNodeId || successor?.nodeId || successor?.sourceNodeId
        if (successorNodeId) {
          resolvedNodeIds.push(successorNodeId)
          continue
        }
      }

      if (inputValue.allowDeleted) {
        const deletedNode = inputValue.session.nodeById.get(locator.nodeId)
        const deletedNodeId =
          deletedNode?.currentNodeId || deletedNode?.nodeId || deletedNode?.sourceNodeId
        if (deletedNodeId) {
          resolvedNodeIds.push(deletedNodeId)
          continue
        }
      }

      return {
        ok: false,
        error:
          inputValue.field === 'anchorNodeId'
            ? `cannot safely resolve anchor after earlier mutations: ${locator.nodeId}`
            : `cannot safely resolve target after earlier mutations: ${locator.nodeId}`
      }
    }

    return {
      ok: true,
      nodeIds: resolvedNodeIds
    }
  }

  const resolveCurrentNodeIdsFromSnapshot = (inputValue: {
    sourcePath: string
    field: 'nodeId' | 'anchorNodeId' | 'cellNodeId' | 'nodeIds'
    nodeIds: string[]
    allowDeleted?: boolean
  }): { ok: true; nodeIds: string[] } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }

    const resolvedNodeIds: string[] = []
    for (const nodeId of inputValue.nodeIds) {
      if (!nodeId) {
        return {
          ok: false,
          error: `cannot resolve empty ${inputValue.field} in current active snapshot`
        }
      }

      const tableNodeIdForCell = session.activeSnapshot.tableNodeIdByCellNodeId.get(nodeId)
      if (tableNodeIdForCell) {
        const tableNode = session.activeSnapshot.nodeById.get(tableNodeIdForCell)
        const cellMatches = tableNode?.tableCells?.filter((cell) => cell.nodeId === nodeId) || []
        if (cellMatches.length !== 1) {
          return {
            ok: false,
            error: `cannot resolve ${inputValue.field}=${nodeId} in current active snapshot`
          }
        }
        resolvedNodeIds.push(nodeId)
        continue
      }

      if (inputValue.field === 'cellNodeId') {
        const tableNodeId = session.activeSnapshot.tableNodeIdByCellNodeId.get(nodeId)
        const tableNode = tableNodeId ? session.activeSnapshot.nodeById.get(tableNodeId) : undefined
        const cellMatches = tableNode?.tableCells?.filter((cell) => cell.nodeId === nodeId) || []
        if (!tableNodeId || cellMatches.length !== 1) {
          return {
            ok: false,
            error: `cannot resolve ${inputValue.field}=${nodeId} in current active snapshot`
          }
        }
        resolvedNodeIds.push(nodeId)
        continue
      }

      const snapshotNode = session.activeSnapshot.nodeById.get(nodeId)
      if (!snapshotNode) {
        return {
          ok: false,
          error: `cannot resolve ${inputValue.field}=${nodeId} in current active snapshot`
        }
      }

      const visibleNodes = listVisibleNodes(session).filter((node) => {
        const currentNodeId = node.currentNodeId || node.nodeId
        return currentNodeId === nodeId
      })
      if (visibleNodes.length !== 1) {
        return {
          ok: false,
          error:
            visibleNodes.length === 0
              ? `cannot bind ${inputValue.field}=${nodeId} to a visible replay node`
              : `cannot uniquely bind ${inputValue.field}=${nodeId} to a visible replay node`
        }
      }

      resolvedNodeIds.push(nodeId)
    }

    return {
      ok: true,
      nodeIds: resolvedNodeIds
    }
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

  const buildOpenStatsFromReplaySnapshot = (snapshot: DocxReplaySnapshot): DocxOpenStats => {
    const paragraphCount = snapshot.nodes.filter((node) => node.kind === 'paragraph').length
    const tableCount = snapshot.nodes.filter((node) => node.kind === 'table').length
    const charCount = snapshot.nodes.reduce((total, node) => {
      const spec = node.spec
      if (spec.kind === 'paragraph') {
        return total + spec.runs.reduce((runTotal, run) => runTotal + run.text.length, 0)
      }
      return (
        total +
        spec.rows.reduce(
          (rowTotal, row) =>
            rowTotal +
            row.reduce(
              (cellTotal, cell) =>
                cellTotal +
                cell.paragraphs.reduce(
                  (paragraphTotal, paragraph) =>
                    paragraphTotal +
                    paragraph.runs.reduce((runTotal, run) => runTotal + run.text.length, 0),
                  0
                ),
              0
            ),
          0
        )
      )
    }, 0)

    return {
      nodeCount: snapshot.nodes.length,
      rootNodeCount: snapshot.nodes.length,
      paragraphCount,
      tableCount,
      imageCount: 0,
      visualCount: 0,
      visualKinds: [],
      charCount
    }
  }

  const syncReplaySessionStats = (session: DocxReplaySession): void => {
    const visualCount = session.stats.visualCount
    const visualKinds = session.stats.visualKinds
    session.stats = {
      ...buildOpenStatsFromReplaySnapshot(session.activeSnapshot),
      imageCount: session.stats.imageCount,
      visualCount,
      visualKinds
    }
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
      meta: session.meta,
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
    registerSnapshot(workerResponse.payload.docId)
    state.sourcePathByDocId.set(workerResponse.payload.docId, normalizedSourcePath)
    const session: DocxReadSession = {
      sourcePath: normalizedSourcePath,
      docId: workerResponse.payload.docId,
      meta: workerResponse.payload.meta,
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
    ranges: Array<{
      fromNodeIndex: number
      toNodeIndex: number
    }>
    includeTables: boolean
    includeCells: boolean
  }): Promise<DocxOutlineNode[]> => {
    const cacheKey = JSON.stringify({
      ranges: inputValue.ranges,
      includeTables: inputValue.includeTables,
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
        ranges: inputValue.ranges,
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
      ranges: [{ fromNodeIndex: 0, toNodeIndex: Number.MAX_SAFE_INTEGER }],
      includeTables: true,
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
    state.revisionEntryByDocId.set(readSession.docId, revisionEntry)
    const session = createReplaySessionFromSnapshot({
      sourcePath: normalizedSourcePath,
      targetMode,
      sourceDocId: readSession.docId,
      meta: readSession.meta,
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
    meta?: DocxOpenMeta
    stats?: DocxOpenStats
    persistedStats: DocxDiskFingerprint
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
        nodeCount: 0,
        rootNodeCount: 0,
        paragraphCount: 0,
        tableCount: 0,
        imageCount: 0,
        visualCount: 0,
        visualKinds: [],
        charCount: 0
      },
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
    registerSnapshot(params.nextDocId, params.previousDocId)
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
    state.revisionEntryByDocId.set(params.nextDocId, revisionEntry)
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
    _docId: string,
    ops: DocxOperation[]
  ): Promise<DocxOperation[]> => ops

  const buildSemanticDocIndex = async (docId: string): Promise<SemanticDocIndex> => {
    const cached = state.semanticIndexByDocId.get(docId)
    if (cached) return cached

    const outline = await fetchOutlineNodes({
      docId,
      ranges: [{ fromNodeIndex: 0, toNodeIndex: Number.MAX_SAFE_INTEGER }],
      includeTables: true,
      includeCells: true
    })

    const searchableNodes = outline.filter(isSemanticSearchableNode)
    const texts = searchableNodes.map((node) => node.text.trim()).filter(Boolean)
    const nodes = searchableNodes.filter((node) => node.text.trim().length > 0)

    if (nodes.length === 0) {
      const emptyIndex = { entries: [] }
      state.semanticIndexByDocId.set(docId, emptyIndex)
      return emptyIndex
    }

    const embeddings = await input.ctx.embeddingService.embed(texts)
    const rows = splitEmbeddingRows(embeddings.data, embeddings.dims)
    if (rows.length !== nodes.length) {
      throw new Error(
        `semantic index row mismatch: nodes=${String(nodes.length)}, rows=${String(rows.length)}`
      )
    }

    const semanticIndex: SemanticDocIndex = {
      entries: nodes.map((node, indexRow) => ({
        nodeId: node.nodeId,
        nodeType: node.type,
        nodeIndex: node.nodeIndex,
        previousNodeId: node.previousNodeId,
        nextNodeId: node.nextNodeId,
        tableNodeId: node.type === 'table_cell' ? node.tableNodeId : undefined,
        text: node.text,
        story: node.story,
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
    buildSemanticDocIndex,
    getRevisionRefByDocId,
    resolveSnapshotTargets,
    resolveCurrentNodeIdFromNodeId,
    resolveLiveNodeIdsFromStableLocators,
    resolveCurrentStableLocatorsFromSnapshot,
    resolveLiveNodeIdsFromStableLocatorsInSession,
    resolveCurrentNodeIdsFromSnapshot,
    cloneActiveReplaySession,
    buildReplaySnapshotForDoc,
    applyTempRevisionToReplaySession,
    buildResourceContext,
    persistDocId
  }
}
