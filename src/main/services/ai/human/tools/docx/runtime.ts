import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiToolCallResult, JsonObject } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxCreatedBlock,
  DocxDetailedBlock,
  DocxDiskFingerprint,
  DocxPostWriteReadback,
  DocxPostWriteReadbackRegion,
  DocxOpenMeta,
  DocxOpenStats,
  DocxOp,
  DocxOutlineBlock,
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
import { isSemanticSearchableBlock, splitEmbeddingRows } from './semanticSearch'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'
import {
  applyRevisionToReplaySession,
  createEmptyReplaySnapshot,
  createReplaySessionFromSnapshot,
  createReplaySnapshot
} from './review/replayTree'
import { isLegacyDocPath, isReadableWordPath } from './legacyDocPolicy'
import { projectDocxReadBlocks } from './publicReadTree'

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
  decisionHint?: JsonObject
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
    decisionHint?: JsonObject
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
    persistedStats: DocxDiskFingerprint
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
    createdBlocksByOp?: NonNullable<DocxRevision['createdBlocksByOp']>
    opNextDocIds?: NonNullable<DocxRevision['opNextDocIds']>
    changedBlocks?: DocxRevision['changedBlocks']
    persistedStats: DocxDiskFingerprint
    stats?: DocxOpenStats
    summary?: string
  }) => Promise<{ currentRevisionRef: string; previousRevisionRef: string }>
  expandOpsForReview: (docId: string, ops: DocxOp[]) => Promise<DocxOp[]>
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
  resolveCurrentBlockIdFromNodeId: (input: {
    sourcePath: string
    nodeId: string
    allowDeleted?: boolean
  }) => { ok: true; blockId: string } | { ok: false; error: string }
  resolveLiveBlockIdsFromStableLocators: (input: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }) => { ok: true; blockIds: string[] } | { ok: false; error: string }
  resolveCurrentStableLocatorsFromSnapshot: (input: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    blockIds: string[]
  }) => { ok: true; stableLocators: DocxStableLocator[] } | { ok: false; error: string }
  resolveLiveBlockIdsFromStableLocatorsInSession: (input: {
    session: DocxReplaySession
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }) => { ok: true; blockIds: string[] } | { ok: false; error: string }
  resolveCurrentBlockIdsFromSnapshot: (input: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    blockIds: string[]
    allowDeleted?: boolean
  }) => { ok: true; blockIds: string[] } | { ok: false; error: string }
  cloneActiveReplaySession: (
    sourcePath: string
  ) => { ok: true; session: DocxReplaySession } | { ok: false; error: string }
  buildReplaySnapshotForDoc: (docId: string) => Promise<DocxReplaySnapshot>
  applyTempRevisionToReplaySession: (input: {
    session: DocxReplaySession
    revisionRef: string
    op: DocxOp
    createdBlocks: DocxCreatedBlock[]
    nextDocId: string
  }) => Promise<void>
  buildResourceContext: (input: {
    sourcePath: string
    effectKind: DocxToolResourceContext['effectKind']
    currentRevisionRef?: string
    previousRevisionRef?: string
  }) => DocxToolResourceContext
  buildPostWriteReadback: (input: {
    docId: string
    regions: Array<{
      fromBlockIndex: number
      toBlockIndex: number
    }>
  }) => Promise<DocxPostWriteReadback>
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
    decisionHint?: JsonObject
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => ({
    ok: false,
    error: params.error,
    decisionHint: params.decisionHint,
    resourceContext: params.resourceContext
  })

  const emitFailure = (params: {
    toolName: string
    toolCallId: string
    reason: string
    error: string
    decisionHint?: JsonObject
    draftDocId?: string
    resourceContext?: DocxToolResourceContext
  }): DocxToolFailure => {
    const out = toFailure({
      reason: params.reason,
      error: params.error,
      decisionHint: params.decisionHint,
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

  const resolveReadableWordPath = (params: { cwd: string; rawPath: string }): string | null => {
    const resolved = resolveToolPath({
      rawPath: params.rawPath,
      cwd: params.cwd
    })
    if (!resolved) return null
    if (!isReadableWordPath(resolved)) return null
    return resolved
  }

  const resolveDocxPath = (params: { cwd: string; rawPath: string }): string | null => {
    const resolved = resolveReadableWordPath(params)
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
          createdBlocks: revision.createdBlocksByOp?.[opIndex] || revision.createdBlocks || [],
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
    blockId: string
  ): DocxReplayNode | undefined =>
    session.bodyNodeIds
      .map((nodeId) => session.nodeById.get(nodeId))
      .find((node): node is DocxReplayNode =>
        Boolean(
          node &&
          node.reviewState !== 'deleted' &&
          node.reviewState !== 'replaced-old' &&
          (node.currentBlockId === blockId ||
            node.blockId === blockId ||
            node.sourceBlockId === blockId)
        )
      )

  const listVisibleNodes = (session: DocxReplaySession): DocxReplayNode[] =>
    session.bodyNodeIds
      .map((nodeId) => session.nodeById.get(nodeId))
      .filter((node): node is DocxReplayNode =>
        Boolean(node && node.reviewState !== 'deleted' && node.reviewState !== 'replaced-old')
      )

  const buildContentFingerprint = (node: DocxReplayNode): string => JSON.stringify(node.spec)

  const buildStableLocatorForNode = (input: {
    session: DocxReplaySession
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    node: DocxReplayNode
    requestedBlockId: string
    tableBlockIdOverride?: string
  }): DocxStableLocator => {
    const visibleNodes = listVisibleNodes(input.session)
    const visibleIndex = visibleNodes.findIndex((node) => node.nodeId === input.node.nodeId)
    const previousVisibleNodeId =
      visibleIndex > 0 ? visibleNodes[visibleIndex - 1]?.nodeId : undefined
    const nextVisibleNodeId =
      visibleIndex >= 0 && visibleIndex < visibleNodes.length - 1
        ? visibleNodes[visibleIndex + 1]?.nodeId
        : undefined
    const tableBlockId =
      input.tableBlockIdOverride ||
      input.session.activeSnapshot.tableBlockIdByCellBlockId.get(input.requestedBlockId)
    const tableNode = tableBlockId
      ? findVisibleNodeByLocator(input.session, tableBlockId)
      : undefined
    const tableSnapshotBlock = tableBlockId
      ? input.session.activeSnapshot.blockById.get(tableBlockId)
      : undefined
    const tableCellMeta = tableBlockId
      ? tableSnapshotBlock?.tableCells?.find((cell) => cell.blockId === input.requestedBlockId)
      : undefined
    return {
      nodeId: input.node.nodeId,
      sourceBlockId: input.node.sourceBlockId,
      currentBlockIdAtResolve:
        input.node.currentBlockId || input.node.blockId || input.node.sourceBlockId,
      blockIndexAtResolve: input.node.blockIndex,
      previousVisibleNodeId,
      nextVisibleNodeId,
      kind: tableBlockId ? 'table_cell' : input.node.kind,
      contentFingerprint: buildContentFingerprint(input.node),
      tableNodeId: tableNode?.nodeId,
      tableSourceBlockId: tableNode?.sourceBlockId,
      tableFingerprint: tableNode ? buildContentFingerprint(tableNode) : undefined,
      cellBlockId: tableBlockId ? input.requestedBlockId : undefined,
      rowIndex: tableCellMeta?.row,
      colIndex: tableCellMeta?.col,
      cellContentFingerprint: tableCellMeta?.text
    }
  }

  const resolveNodeIdsForLocatorField = (inputValue: {
    session: DocxReplaySession
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    rawValue: JsonObject[string]
  }): DocxStableLocator[] => {
    const blockIds =
      inputValue.field === 'blockIds'
        ? Array.isArray(inputValue.rawValue)
          ? inputValue.rawValue.filter(
              (value): value is string => typeof value === 'string' && value.length > 0
            )
          : []
        : typeof inputValue.rawValue === 'string' && inputValue.rawValue.length > 0
          ? [inputValue.rawValue]
          : []
    return blockIds.map((blockId) => {
      const tableBlockId = inputValue.session.activeSnapshot.tableBlockIdByCellBlockId.get(blockId)
      if (tableBlockId) {
        const tableNode = findVisibleNodeByLocator(inputValue.session, tableBlockId)
        if (!tableNode) {
          throw new Error(
            `cannot resolve table for ${inputValue.field}=${blockId} in base revision`
          )
        }
        return buildStableLocatorForNode({
          session: inputValue.session,
          field: inputValue.field,
          node: tableNode,
          requestedBlockId: blockId,
          tableBlockIdOverride: tableBlockId
        })
      }

      const node = findVisibleNodeByLocator(inputValue.session, blockId)
      if (!node) {
        throw new Error(`cannot resolve ${inputValue.field}=${blockId} in base revision`)
      }
      return buildStableLocatorForNode({
        session: inputValue.session,
        field: inputValue.field,
        node,
        requestedBlockId: blockId
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
        ;(['blockId', 'anchorBlockId', 'cellBlockId', 'blockIds'] as const).forEach((field) => {
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

  const resolveCurrentBlockIdFromNodeId = (inputValue: {
    sourcePath: string
    nodeId: string
    allowDeleted?: boolean
  }): { ok: true; blockId: string } | { ok: false; error: string } => {
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
    const currentBlockId = node.currentBlockId || node.blockId || node.sourceBlockId
    if (!currentBlockId) {
      return {
        ok: false,
        error: `resolved node has no current block binding: ${inputValue.nodeId}`
      }
    }
    return {
      ok: true,
      blockId: currentBlockId
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

  const findVisibleNodeBySourceBlockId = (
    session: DocxReplaySession,
    sourceBlockId: string | undefined
  ): DocxReplayNode[] => {
    if (!sourceBlockId) return []
    return listVisibleNodes(session).filter((node) => node.sourceBlockId === sourceBlockId)
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
      findVisibleNodeBySourceBlockId(input.session, input.locator.tableSourceBlockId)[0]
    if (!tableNode) return undefined
    const tableBlockId = tableNode.currentBlockId || tableNode.blockId || tableNode.sourceBlockId
    if (!tableBlockId) return undefined
    const snapshotBlock = input.session.activeSnapshot.blockById.get(tableBlockId)
    const matchedCell = snapshotBlock?.tableCells?.find(
      (cell) => cell.row === input.locator.rowIndex && cell.col === input.locator.colIndex
    )
    return matchedCell?.blockId
  }

  const resolveLiveBlockIdsFromStableLocators = (inputValue: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }): { ok: true; blockIds: string[] } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }

    const resolvedBlockIds: string[] = []
    for (const locator of inputValue.stableLocators) {
      if (inputValue.field === 'cellBlockId') {
        const visibleCellBlockId = resolveVisibleCellByTableCoordinates({
          session,
          locator
        })
        if (visibleCellBlockId) {
          resolvedBlockIds.push(visibleCellBlockId)
          continue
        }
      }

      const visibleNode = findVisibleNodeById(session, locator.nodeId)
      if (visibleNode) {
        const blockId =
          visibleNode.currentBlockId || visibleNode.blockId || visibleNode.sourceBlockId
        if (!blockId) {
          return {
            ok: false,
            error: `resolved node has no current block binding: ${locator.nodeId}`
          }
        }
        resolvedBlockIds.push(blockId)
        continue
      }

      const historicalNode = session.nodeById.get(locator.nodeId)
      if (historicalNode?.successorNodeId) {
        const successor = findVisibleNodeById(session, historicalNode.successorNodeId)
        if (inputValue.field === 'cellBlockId') {
          const successorCellBlockId = resolveVisibleCellByTableCoordinates({
            session,
            locator
          })
          if (successorCellBlockId) {
            resolvedBlockIds.push(successorCellBlockId)
            continue
          }
        }
        const successorBlockId =
          successor?.currentBlockId || successor?.blockId || successor?.sourceBlockId
        if (successorBlockId) {
          resolvedBlockIds.push(successorBlockId)
          continue
        }
      }

      const sourceMatches = findVisibleNodeBySourceBlockId(session, locator.sourceBlockId)
      if (sourceMatches.length === 1) {
        const blockId =
          sourceMatches[0].currentBlockId ||
          sourceMatches[0].blockId ||
          sourceMatches[0].sourceBlockId
        if (!blockId) {
          return {
            ok: false,
            error: `resolved node has no current block binding: ${locator.nodeId}`
          }
        }
        resolvedBlockIds.push(blockId)
        continue
      }

      if (inputValue.field === 'cellBlockId' || locator.kind === 'table_cell') {
        const recoveredCellBlockId = resolveVisibleCellByTableCoordinates({
          session,
          locator
        })
        if (recoveredCellBlockId) {
          resolvedBlockIds.push(recoveredCellBlockId)
          continue
        }
      }

      const previousVisible = findVisibleNodeById(session, locator.previousVisibleNodeId)
      const nextVisible = findVisibleNodeById(session, locator.nextVisibleNodeId)
      if (inputValue.field === 'anchorBlockId') {
        const neighbor = previousVisible || nextVisible
        const blockId = neighbor?.currentBlockId || neighbor?.blockId || neighbor?.sourceBlockId
        if (blockId) {
          resolvedBlockIds.push(blockId)
          continue
        }
      }

      return {
        ok: false,
        error:
          inputValue.field === 'anchorBlockId'
            ? `cannot safely resolve anchor after earlier mutations: ${locator.nodeId}`
            : `cannot safely resolve target after earlier mutations: ${locator.nodeId}`
      }
    }

    return {
      ok: true,
      blockIds: resolvedBlockIds
    }
  }

  const resolveCurrentStableLocatorsFromSnapshot = (inputValue: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    blockIds: string[]
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
          rawValue: inputValue.field === 'blockIds' ? inputValue.blockIds : inputValue.blockIds[0]
        })
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  const resolveLiveBlockIdsFromStableLocatorsInSession = (inputValue: {
    session: DocxReplaySession
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    stableLocators: DocxStableLocator[]
    allowDeleted?: boolean
  }): { ok: true; blockIds: string[] } | { ok: false; error: string } => {
    const resolvedBlockIds: string[] = []
    for (const locator of inputValue.stableLocators) {
      if (inputValue.field === 'cellBlockId' || locator.kind === 'table_cell') {
        const visibleCellBlockId = resolveVisibleCellByTableCoordinates({
          session: inputValue.session,
          locator
        })
        if (visibleCellBlockId) {
          resolvedBlockIds.push(visibleCellBlockId)
          continue
        }
      }

      const visibleNode = findVisibleNodeById(inputValue.session, locator.nodeId)
      if (visibleNode) {
        const blockId =
          visibleNode.currentBlockId || visibleNode.blockId || visibleNode.sourceBlockId
        if (!blockId) {
          return {
            ok: false,
            error: `resolved node has no current block binding: ${locator.nodeId}`
          }
        }
        resolvedBlockIds.push(blockId)
        continue
      }

      const historicalNode = inputValue.session.nodeById.get(locator.nodeId)
      if (historicalNode?.successorNodeId) {
        if (inputValue.field === 'cellBlockId' || locator.kind === 'table_cell') {
          const successorCellBlockId = resolveVisibleCellByTableCoordinates({
            session: inputValue.session,
            locator
          })
          if (successorCellBlockId) {
            resolvedBlockIds.push(successorCellBlockId)
            continue
          }
        }
        const successor = findVisibleNodeById(inputValue.session, historicalNode.successorNodeId)
        const successorBlockId =
          successor?.currentBlockId || successor?.blockId || successor?.sourceBlockId
        if (successorBlockId) {
          resolvedBlockIds.push(successorBlockId)
          continue
        }
      }

      if (inputValue.allowDeleted) {
        const deletedNode = inputValue.session.nodeById.get(locator.nodeId)
        const deletedBlockId =
          deletedNode?.currentBlockId || deletedNode?.blockId || deletedNode?.sourceBlockId
        if (deletedBlockId) {
          resolvedBlockIds.push(deletedBlockId)
          continue
        }
      }

      return {
        ok: false,
        error:
          inputValue.field === 'anchorBlockId'
            ? `cannot safely resolve anchor after earlier mutations: ${locator.nodeId}`
            : `cannot safely resolve target after earlier mutations: ${locator.nodeId}`
      }
    }

    return {
      ok: true,
      blockIds: resolvedBlockIds
    }
  }

  const resolveCurrentBlockIdsFromSnapshot = (inputValue: {
    sourcePath: string
    field: 'blockId' | 'anchorBlockId' | 'cellBlockId' | 'blockIds'
    blockIds: string[]
    allowDeleted?: boolean
  }): { ok: true; blockIds: string[] } | { ok: false; error: string } => {
    const session = state.replaySessionBySourcePath.get(path.resolve(inputValue.sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `docx session not found for sourcePath: ${path.resolve(inputValue.sourcePath)}`
      }
    }

    const resolvedBlockIds: string[] = []
    for (const blockId of inputValue.blockIds) {
      if (!blockId) {
        return {
          ok: false,
          error: `cannot resolve empty ${inputValue.field} in current active snapshot`
        }
      }

      const tableBlockIdForCell = session.activeSnapshot.tableBlockIdByCellBlockId.get(blockId)
      if (tableBlockIdForCell) {
        const tableBlock = session.activeSnapshot.blockById.get(tableBlockIdForCell)
        const cellMatches = tableBlock?.tableCells?.filter((cell) => cell.blockId === blockId) || []
        if (cellMatches.length !== 1) {
          return {
            ok: false,
            error: `cannot resolve ${inputValue.field}=${blockId} in current active snapshot`
          }
        }
        resolvedBlockIds.push(blockId)
        continue
      }

      if (inputValue.field === 'cellBlockId') {
        const tableBlockId = session.activeSnapshot.tableBlockIdByCellBlockId.get(blockId)
        const tableBlock = tableBlockId
          ? session.activeSnapshot.blockById.get(tableBlockId)
          : undefined
        const cellMatches = tableBlock?.tableCells?.filter((cell) => cell.blockId === blockId) || []
        if (!tableBlockId || cellMatches.length !== 1) {
          return {
            ok: false,
            error: `cannot resolve ${inputValue.field}=${blockId} in current active snapshot`
          }
        }
        resolvedBlockIds.push(blockId)
        continue
      }

      const snapshotBlock = session.activeSnapshot.blockById.get(blockId)
      if (!snapshotBlock) {
        return {
          ok: false,
          error: `cannot resolve ${inputValue.field}=${blockId} in current active snapshot`
        }
      }

      const visibleNodes = listVisibleNodes(session).filter((node) => {
        const currentBlockId = node.currentBlockId || node.blockId
        return currentBlockId === blockId
      })
      if (visibleNodes.length !== 1) {
        return {
          ok: false,
          error:
            visibleNodes.length === 0
              ? `cannot bind ${inputValue.field}=${blockId} to a visible replay node`
              : `cannot uniquely bind ${inputValue.field}=${blockId} to a visible replay node`
        }
      }

      resolvedBlockIds.push(blockId)
    }

    return {
      ok: true,
      blockIds: resolvedBlockIds
    }
  }

  const createReadSessionCache = (): DocxReadSession['cache'] => ({
    outlineByCacheKey: new Map(),
    detailByBlockId: new Map()
  })

  const cacheOutline = (
    session: DocxReadSession | undefined,
    key: string,
    value: { blocks: DocxOutlineBlock[] }
  ) => {
    if (!session) return
    session.cache.outlineByCacheKey.set(key, value)
  }

  const cacheDetailedBlocks = (
    session: DocxReadSession | undefined,
    blocks: readonly DocxDetailedBlock[]
  ) => {
    if (!session) return
    blocks.forEach((block) => {
      session.cache.detailByBlockId.set(block.blockId, block)
    })
  }

  const buildOpenStatsFromReplaySnapshot = (snapshot: DocxReplaySnapshot): DocxOpenStats => {
    const paragraphCount = snapshot.blocks.filter((block) => block.kind === 'paragraph').length
    const tableCount = snapshot.blocks.filter((block) => block.kind === 'table').length
    const charCount = snapshot.blocks.reduce((total, block) => {
      const spec = block.spec
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
      blockCount: snapshot.blocks.length,
      bodyBlockCount: snapshot.blocks.length,
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

  const fetchOutlineBlocks = async (inputValue: {
    session?: DocxReadSession
    docId: string
    ranges: Array<{
      fromBlockIndex: number
      toBlockIndex: number
    }>
    includeTables: boolean
    includeCells: boolean
  }): Promise<DocxOutlineBlock[]> => {
    const cacheKey = JSON.stringify({
      ranges: inputValue.ranges,
      includeTables: inputValue.includeTables,
      includeCells: inputValue.includeCells
    })
    const cached = inputValue.session?.cache.outlineByCacheKey.get(cacheKey)
    if (cached) {
      return cached.blocks
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
      blocks: outlineResponse.payload.blocks
    }
    cacheOutline(inputValue.session || undefined, cacheKey, result)
    return result.blocks
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
    const outlineBlocks = await fetchOutlineBlocks({
      session,
      docId,
      ranges: [{ fromBlockIndex: 0, toBlockIndex: Number.MAX_SAFE_INTEGER }],
      includeTables: true,
      includeCells: true
    })
    const detailedBlocks = await fetchDetailedBlocksByIds(
      docId,
      outlineBlocks.map((block) => block.blockId),
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
      outlineBlocks,
      detailedBlocksById: new Map(detailedBlocks.map((block) => [block.blockId, block] as const)),
      rawXmlByBlockId: new Map(
        rawXmlResponse.payload.blocks.map((block) => [block.blockId, block.rawXml] as const)
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
    const requestedSourcePath = resolveReadableWordPath({
      cwd: workspaceRootPath,
      rawPath: params.sourcePath
    })
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
    const requestedSourcePath = resolveDocxPath({
      cwd: workspaceRootPath,
      rawPath: params.sourcePath
    })
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

  const stringifyBlockSpec = (spec: DocxReplaySnapshot['blocks'][number]['spec']): string => {
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
        blockCount: 0,
        bodyBlockCount: 0,
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
    const createdBlocks = buildCreatedBlocksFromSnapshot(workingSnapshot)
    const changedBlocks = buildInsertedChangedBlocksFromSnapshot(workingSnapshot)
    const revisionUpdate = await registerRevision({
      sourcePath: normalizedSourcePath,
      previousDocId: params.baselineDocId,
      nextDocId: params.workingDocId,
      ops: [{ type: 'create_document' }],
      createdBlocks,
      changedBlocks,
      persistedStats: params.persistedStats,
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
    createdBlocksByOp?: NonNullable<DocxRevision['createdBlocksByOp']>
    opNextDocIds?: NonNullable<DocxRevision['opNextDocIds']>
    changedBlocks?: DocxRevision['changedBlocks']
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
      changedBlocks: params.changedBlocks,
      summary: params.summary,
      ops: params.ops,
      createdBlocks: params.createdBlocks,
      createdBlocksByOp: params.createdBlocksByOp,
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
        createdBlocks: params.createdBlocksByOp?.[opIndex] || params.createdBlocks || [],
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
      bodyNodeIds: [...source.bodyNodeIds]
    }
    return {
      ok: true,
      session: clone
    }
  }

  const applyTempRevisionToReplaySession = async (params: {
    session: DocxReplaySession
    revisionRef: string
    op: DocxOp
    createdBlocks: DocxCreatedBlock[]
    nextDocId: string
  }): Promise<void> => {
    const nextSnapshot = await buildReplaySnapshotForDoc(params.nextDocId)
    applyRevisionToReplaySession({
      session: params.session,
      revisionRef: params.revisionRef,
      op: params.op,
      createdBlocks: params.createdBlocks,
      nextSnapshot
    })
    params.session.activeDocId = params.nextDocId
    params.session.activeRevisionRef = params.revisionRef
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

    const outline = await fetchOutlineBlocks({
      docId,
      ranges: [{ fromBlockIndex: 0, toBlockIndex: Number.MAX_SAFE_INTEGER }],
      includeTables: true,
      includeCells: true
    })

    const searchableBlocks = outline.filter(isSemanticSearchableBlock)
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
        blockIndex: block.blockIndex,
        previousBlockId: block.previousBlockId,
        nextBlockId: block.nextBlockId,
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

  const buildPostWriteReadback = async (input: {
    docId: string
    regions: Array<{
      fromBlockIndex: number
      toBlockIndex: number
    }>
  }): Promise<DocxPostWriteReadback> => {
    const readbackRegions: DocxPostWriteReadbackRegion[] = []
    for (const region of input.regions) {
      const response = await callWorker({
        action: 'get_blocks_by_block_index_range',
        payload: {
          docId: input.docId,
          fromBlockIndex: region.fromBlockIndex,
          toBlockIndex: region.toBlockIndex
        }
      })
      if (!response.ok) {
        throw new Error(response.error)
      }
      if (response.payload.action !== 'get_blocks_by_block_index_range') {
        throw new Error('worker protocol mismatch (get_blocks_by_block_index_range)')
      }
      const startBlockId = response.payload.blocks[0]?.blockId
      const endBlockId = response.payload.blocks.at(-1)?.blockId
      readbackRegions.push({
        fromBlockId: startBlockId || '',
        fromBlockIndex: region.fromBlockIndex,
        toBlockId: endBlockId || '',
        toBlockIndex: region.toBlockIndex,
        blocks: projectDocxReadBlocks(response.payload.blocks)
      })
    }
    return {
      regions: readbackRegions
    }
  }

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
    resolveCurrentBlockIdFromNodeId,
    resolveLiveBlockIdsFromStableLocators,
    resolveCurrentStableLocatorsFromSnapshot,
    resolveLiveBlockIdsFromStableLocatorsInSession,
    resolveCurrentBlockIdsFromSnapshot,
    cloneActiveReplaySession,
    buildReplaySnapshotForDoc,
    applyTempRevisionToReplaySession,
    buildResourceContext,
    buildPostWriteReadback,
    persistDocId
  }
}
