import path from 'node:path'
import type { AiToolCallResult } from '../../../../../../shared/types'
import type {
  DocxCapabilityToolsInput,
  DocxCapabilityToolsRuntimeState,
  DocxDocumentSession,
  DocxOp,
  DocxSnapshotLineageEntry,
  DocxToolResultCode,
  DocxVersionEntry,
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
  currentVersionRef?: string
  previousVersionRef?: string
  effectKind?: 'opened' | 'read' | 'searched' | 'mutated' | 'rolled_back' | 'history'
}

type ResolvedDocSession = {
  sourcePath: string
  session: DocxDocumentSession
  docId: string
  currentVersionRef: string
}

type RequireDocSessionResult =
  | { sourcePath: string; session: DocxDocumentSession; docId: string; currentVersionRef: string }
  | { failure: DocxToolFailure }

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
    input.code === 'approval_denied'
      ? { kind: 'approval_denied' }
      : input.code === 'invalid_input'
        ? { kind: 'invalid_input' }
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
  requireDocumentSession: (input: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }) => RequireDocSessionResult
  registerOpenedDocument: (sourcePath: string, docId: string) => {
    session: DocxDocumentSession
    currentVersionRef: string
  }
  registerDerivedVersion: (input: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
  }) => { currentVersionRef: string; previousVersionRef: string }
  buildVersionHistory: (
    sourcePath: string,
    maxDepth: number
  ) => Array<DocxVersionEntry & { isCurrent: boolean }>
  resolveRollbackTarget: (
    sourcePath: string,
    targetVersionRef?: string,
    steps?: number
  ) =>
    | {
        ok: true
        targetDocId: string
        targetVersionRef: string
        previousVersionRef: string
        stepsApplied: number
      }
    | { ok: false; error: string }
  activateVersion: (input: {
    sourcePath: string
    targetDocId: string
    targetVersionRef: string
  }) => { previousVersionRef: string; currentVersionRef: string }
  expandOpsForReview: (docId: string, ops: DocxOp[]) => Promise<DocxOp[]>
  buildSemanticDocIndex: (docId: string) => Promise<SemanticDocIndex>
  getVersionRefByDocId: (docId: string) => string | undefined
  buildResourceContext: (input: {
    sourcePath: string
    effectKind: DocxToolResourceContext['effectKind']
    currentVersionRef?: string
    previousVersionRef?: string
  }) => DocxToolResourceContext
}

const buildRequiredDocumentError = (toolName: string, sourcePath: string): string =>
  `sourcePath must be opened before ${toolName}: ${sourcePath}`

export const createDocxToolRuntime = (input: DocxCapabilityToolsInput): DocxToolRuntime => {
  const state: DocxCapabilityToolsRuntimeState = {
    sourcePathByDocId: new Map(),
    semanticIndexByDocId: new Map(),
    snapshotEntryByDocId: new Map(),
    versionEntryByDocId: new Map(),
    documentSessionBySourcePath: new Map()
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

  const getVersionRefByDocId = (docId: string): string | undefined =>
    state.versionEntryByDocId.get(docId)?.versionRef

  const requireDocumentSession = (params: {
    toolName: string
    toolCallId: string
    sourcePath: string
  }): RequireDocSessionResult => {
    const sourcePath = path.resolve(params.sourcePath)
    const session = state.documentSessionBySourcePath.get(sourcePath)
    if (session) {
      return {
        sourcePath,
        session,
        docId: session.activeDocId,
        currentVersionRef: session.activeVersionRef
      }
    }
    return {
      failure: emitFailure({
        toolName: params.toolName,
        toolCallId: params.toolCallId,
        code: 'invalid_input',
        error: buildRequiredDocumentError(params.toolName, sourcePath),
        resourceContext: {
          family: 'docx',
          sourcePath
        }
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
        currentVersionRef: existing.activeVersionRef
      }
    }

    registerSnapshot(docId)
    state.sourcePathByDocId.set(docId, normalizedSourcePath)
    const versionEntry: DocxVersionEntry = {
      versionRef: 'v1',
      docId,
      createdAt: Date.now()
    }
    state.versionEntryByDocId.set(docId, versionEntry)
    const session: DocxDocumentSession = {
      sourcePath: normalizedSourcePath,
      activeDocId: docId,
      activeVersionRef: 'v1',
      nextVersionNumber: 2,
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
      docIdByVersionRef: new Map([['v1', docId]]),
      versionRefByDocId: new Map([[docId, 'v1']])
    }
    state.documentSessionBySourcePath.set(normalizedSourcePath, session)
    return {
      session,
      currentVersionRef: 'v1'
    }
  }

  const registerDerivedVersion = (params: {
    sourcePath: string
    previousDocId: string
    nextDocId: string
  }) => {
    const sourcePath = path.resolve(params.sourcePath)
    const session = state.documentSessionBySourcePath.get(sourcePath)
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${sourcePath}`)
    }
    const previousVersionRef = session.versionRefByDocId.get(params.previousDocId)
    if (!previousVersionRef) {
      throw new Error(`previous docId is not tracked in docx session: ${params.previousDocId}`)
    }
    const currentVersionRef = `v${String(session.nextVersionNumber)}`
    session.nextVersionNumber += 1
    session.activeDocId = params.nextDocId
    session.activeVersionRef = currentVersionRef
    session.docIdByVersionRef.set(currentVersionRef, params.nextDocId)
    session.versionRefByDocId.set(params.nextDocId, currentVersionRef)
    state.sourcePathByDocId.set(params.nextDocId, sourcePath)
    registerSnapshot(params.nextDocId, params.previousDocId)
    state.versionEntryByDocId.set(params.nextDocId, {
      versionRef: currentVersionRef,
      docId: params.nextDocId,
      parentVersionRef: previousVersionRef,
      createdAt: Date.now()
    })
    return {
      currentVersionRef,
      previousVersionRef
    }
  }

  const buildVersionHistory = (
    sourcePath: string,
    maxDepth: number
  ): Array<DocxVersionEntry & { isCurrent: boolean }> => {
    const session = state.documentSessionBySourcePath.get(path.resolve(sourcePath))
    if (!session) return []
    const entries: Array<DocxVersionEntry & { isCurrent: boolean }> = []
    let currentVersionRef = session.activeVersionRef
    let traversed = 0

    while (currentVersionRef && traversed < maxDepth) {
      const docId = session.docIdByVersionRef.get(currentVersionRef)
      if (!docId) break
      const entry = state.versionEntryByDocId.get(docId)
      if (!entry) break
      entries.push({
        ...entry,
        isCurrent: currentVersionRef === session.activeVersionRef
      })
      currentVersionRef = entry.parentVersionRef || ''
      traversed += 1
    }

    return entries
  }

  const resolveRollbackTarget = (
    sourcePath: string,
    targetVersionRef?: string,
    steps?: number
  ):
    | {
        ok: true
        targetDocId: string
        targetVersionRef: string
        previousVersionRef: string
        stepsApplied: number
      }
    | { ok: false; error: string } => {
    const session = state.documentSessionBySourcePath.get(path.resolve(sourcePath))
    if (!session) {
      return {
        ok: false,
        error: `sourcePath must be opened before docx_rollback: ${path.resolve(sourcePath)}`
      }
    }

    if (targetVersionRef) {
      let cursor = session.activeVersionRef
      let stepsApplied = 0
      while (cursor) {
        if (cursor === targetVersionRef) {
          const targetDocId = session.docIdByVersionRef.get(targetVersionRef)
          if (!targetDocId) {
            return { ok: false, error: 'targetVersionRef is not tracked in current docx session' }
          }
          return {
            ok: true,
            targetDocId,
            targetVersionRef,
            previousVersionRef: session.activeVersionRef,
            stepsApplied
          }
        }
        const docId = session.docIdByVersionRef.get(cursor)
        const entry = docId ? state.versionEntryByDocId.get(docId) : undefined
        if (!entry?.parentVersionRef) break
        cursor = entry.parentVersionRef
        stepsApplied += 1
      }
      return {
        ok: false,
        error: 'targetVersionRef must be the current version or one of its ancestors'
      }
    }

    let cursor = session.activeVersionRef
    const targetSteps = Math.max(1, Number(steps || 1))
    let stepsApplied = 0
    while (stepsApplied < targetSteps) {
      const docId = session.docIdByVersionRef.get(cursor)
      const entry = docId ? state.versionEntryByDocId.get(docId) : undefined
      if (!entry?.parentVersionRef) {
        return {
          ok: false,
          error: 'rollback target exceeds available parent versions'
        }
      }
      cursor = entry.parentVersionRef
      stepsApplied += 1
    }
    const targetDocId = session.docIdByVersionRef.get(cursor)
    if (!targetDocId) {
      return { ok: false, error: 'rollback target is not tracked in current docx session' }
    }
    return {
      ok: true,
      targetDocId,
      targetVersionRef: cursor,
      previousVersionRef: session.activeVersionRef,
      stepsApplied
    }
  }

  const activateVersion = (params: {
    sourcePath: string
    targetDocId: string
    targetVersionRef: string
  }) => {
    const session = state.documentSessionBySourcePath.get(path.resolve(params.sourcePath))
    if (!session) {
      throw new Error(`docx session not found for sourcePath: ${params.sourcePath}`)
    }
    const previousVersionRef = session.activeVersionRef
    session.activeDocId = params.targetDocId
    session.activeVersionRef = params.targetVersionRef
    return {
      previousVersionRef,
      currentVersionRef: params.targetVersionRef
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
    currentVersionRef?: string
    previousVersionRef?: string
  }): DocxToolResourceContext => ({
    family: 'docx',
    sourcePath: path.resolve(params.sourcePath),
    currentVersionRef: params.currentVersionRef,
    previousVersionRef: params.previousVersionRef,
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
    requireDocumentSession,
    registerOpenedDocument,
    registerDerivedVersion,
    buildVersionHistory,
    resolveRollbackTarget,
    activateVersion,
    expandOpsForReview,
    buildSemanticDocIndex,
    getVersionRefByDocId,
    buildResourceContext
  }
}
