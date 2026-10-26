import { getPartnerRuntimeDir } from '../../../../assets/WorkspaceAssetService'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiToolCallResult } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxCreatedNode,
  DocxChangedNode,
  DocxDiskFingerprint,
  DocxOpenStats,
  DocxOutlineNode,
  DocxReadSession,
  DocxEditSession
} from './types'
import { getDocxWorkerClient } from './worker/docxWorkerClient'
import type { DocxWorkerRequest, DocxWorkerResponse } from './worker/types'
import { resolveToolPath } from '../terminal/commandPolicy'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'
import { createEditSession } from './review/editSession'
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
      editSession?: DocxEditSession
    }
  | { failure: DocxToolFailure }

export type RequireEditSessionResult =
  | {
      sourcePath: string
      session: DocxEditSession
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
  getEditSession: (sourcePath: string) => DocxEditSession | undefined
  ensureReadSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }) => Promise<RequireReadSessionResult>
  ensureEditSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
    reason?: 'history' | 'edit' | 'rollback'
  }) => Promise<RequireEditSessionResult>
  registerCreatedDocument: (input: {
    sourcePath: string
    baselineDocId: string
    workingDocId: string
    stats?: DocxOpenStats
    persistedStats: DocxDiskFingerprint
  }) => Promise<{
    session: DocxEditSession
    previousRevisionRef: string
    currentRevisionRef: string
    changedNodes: DocxChangedNode[]
    createdNodes: DocxCreatedNode[]
  }>
  registerRevision: (input: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
    persistedStats: DocxDiskFingerprint
    stats?: DocxOpenStats
  }) => Promise<{ currentRevisionRef: string; previousRevisionRef: string }>
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
  const editSessionBySourcePath = new Map<string, DocxEditSession>()
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    readSessionBySourcePath,
    editSessionBySourcePath
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

  const getEditSession = (sourcePath: string): DocxEditSession | undefined =>
    state.editSessionBySourcePath.get(path.resolve(sourcePath))

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
    state.editSessionBySourcePath.delete(sourcePath)
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

  const buildReadSessionResultFromEditSession = (
    sourcePath: string,
    session: DocxEditSession
  ): Exclude<RequireReadSessionResult, { failure: DocxToolFailure }> => {
    return {
      sourcePath,
      docId: session.activeDocId,
      currentRevisionRef: session.activeRevisionRef,
      stats: session.stats,
      editSession: session
    }
  }

  const buildEditSessionResult = (
    sourcePath: string,
    session: DocxEditSession
  ): Exclude<RequireEditSessionResult, { failure: DocxToolFailure }> => ({
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

  const upgradeReadSessionToEditSession = async (
    sourcePath: string,
    targetMode: DocxEditSession['targetMode']
  ): Promise<DocxEditSession> => {
    const normalizedSourcePath = path.resolve(sourcePath)
    const existingEditSession = getEditSession(normalizedSourcePath)
    if (existingEditSession) return existingEditSession
    const readSession = getReadSession(normalizedSourcePath)
    if (!readSession) {
      throw new Error(`read session not found for sourcePath: ${normalizedSourcePath}`)
    }
    const session = createEditSession({
      sourcePath: normalizedSourcePath,
      targetMode,
      sourceDocId: readSession.docId,
      stats: readSession.stats,
      diskFingerprint: readSession.diskFingerprint
    })
    session.docIdByRevisionRef = new Map([[readSession.currentRevisionRef, readSession.docId]])
    session.revisionRefByDocId = new Map([[readSession.docId, readSession.currentRevisionRef]])
    state.editSessionBySourcePath.set(normalizedSourcePath, session)
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

    const editSession = getEditSession(requestedSourcePath)
    if (editSession) {
      if (!(await isSessionFresh(requestedSourcePath, editSession.diskFingerprint))) {
        return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
      }
      return buildReadSessionResultFromEditSession(requestedSourcePath, editSession)
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

  const ensureEditSession = async (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
    reason?: 'history' | 'edit' | 'rollback'
  }): Promise<RequireEditSessionResult> => {
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

    const existingEditSession = getEditSession(requestedSourcePath)
    if (existingEditSession) {
      if (!(await isSessionFresh(requestedSourcePath, existingEditSession.diskFingerprint))) {
        return { failure: externalChangeFailure({ ...params, sourcePath: requestedSourcePath }) }
      }
      return buildEditSessionResult(requestedSourcePath, existingEditSession)
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
            error: 'cannot upgrade an active editable read context'
          })
        }
      }
    }

    try {
      const session = await upgradeReadSessionToEditSession(readSession.sourcePath, 'update')
      return buildEditSessionResult(session.sourcePath, session)
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

  const registerCreatedDocument = async (params: {
    sourcePath: string
    baselineDocId: string
    workingDocId: string
    stats?: DocxOpenStats
    persistedStats: DocxDiskFingerprint
  }) => {
    const normalizedSourcePath = path.resolve(params.sourcePath)
    if (state.editSessionBySourcePath.has(normalizedSourcePath)) {
      throw new Error(`docx session already exists for sourcePath: ${normalizedSourcePath}`)
    }

    state.readSessionBySourcePath.delete(normalizedSourcePath)
    state.sourcePathByDocId.set(params.baselineDocId, normalizedSourcePath)
    const session = createEditSession({
      sourcePath: normalizedSourcePath,
      targetMode: 'create',
      sourceDocId: params.baselineDocId,
      stats: params.stats || { rootNodeCount: 0 },
      diskFingerprint: params.persistedStats
    })
    state.editSessionBySourcePath.set(normalizedSourcePath, session)

    const outline = await fetchOutlineNodes({
      docId: params.workingDocId,
      fromNodeIndex: 0,
      toNodeIndex: Number.MAX_SAFE_INTEGER,
      includeCells: true
    })
    const createdNodes = outline.map((node) => ({ nodeId: node.nodeId, type: node.type }))
    const changedNodes: DocxChangedNode[] = outline
      .filter((node) => node.type !== 'table_cell')
      .map((node) => ({
        action: 'inserted',
        nodeId: node.nodeId,
        beforeText: '',
        afterText: node.text
      }))
    const revisionUpdate = await registerRevision({
      sourcePath: normalizedSourcePath,
      previousDocId: params.baselineDocId,
      nextDocId: params.workingDocId,
      persistedStats: params.persistedStats
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
    persistedStats: DocxDiskFingerprint
    stats?: DocxOpenStats
  }) => {
    const sourcePath = path.resolve(params.sourcePath)
    const session = state.editSessionBySourcePath.get(sourcePath)
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
    session.activeDocId = params.nextDocId
    session.activeRevisionRef = currentRevisionRef
    session.diskFingerprint = params.persistedStats
    if (params.stats) session.stats = params.stats
    else
      session.stats = {
        rootNodeCount: (
          await fetchOutlineNodes({
            docId: params.nextDocId,
            fromNodeIndex: 0,
            toNodeIndex: Number.MAX_SAFE_INTEGER,
            includeCells: false
          })
        ).length
      }
    return {
      currentRevisionRef,
      previousRevisionRef
    }
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
    const exportDir = path.join(
      getPartnerRuntimeDir(input.ctx.partnerId),
      'file-changes',
      input.ctx.ownerRunId,
      'exports'
    )
    const tempPath = path.join(exportDir, `${randomUUID()}.docx`)
    let publishing = false
    try {
      await fs.mkdir(exportDir, { recursive: true })
      const result = await callWorker({
        action: 'materialize_draft',
        payload: { docId: inputValue.docId, outPath: tempPath }
      })
      if (!result.ok) throw new Error(result.error)
      if (result.payload.action !== 'materialize_draft')
        throw new Error(
          'Internal error: invalid Word export protocol. Report the issue. The file has not been saved.'
        )
      const buffer = await fs.readFile(tempPath)
      if (createHash('sha256').update(buffer).digest('hex') !== result.payload.checksum)
        throw new Error('Word export verification failed. The file has not been saved.')
      publishing = true
      const confirmed = await input.ctx.writeFileChange({
        sourcePath,
        buffer,
        capability: 'docx',
        expectedChecksum: state.editSessionBySourcePath.get(sourcePath)?.diskFingerprint.checksum
      })
      return confirmed
    } catch (error) {
      state.editSessionBySourcePath.delete(sourcePath)
      state.readSessionBySourcePath.delete(sourcePath)
      if (publishing) throw error
      console.error('[DOCX-EXPORT]', error)
      const detail = (error instanceof Error ? error.message : String(error))
        .replace(tempPath, '文档')
        .replace(/(?:[A-Za-z]:)?[\\/]\S+/g, '文件位置')
      throw new Error(`Document save preparation failed: ${detail}. The file has not been saved.`)
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined)
      await fs.rmdir(exportDir).catch(() => undefined)
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
    getEditSession,
    ensureReadSession,
    ensureEditSession,
    registerCreatedDocument,
    registerRevision,
    buildResourceContext,
    persistDocId
  }
}
