import fs from 'node:fs/promises'
import path from 'node:path'
import type { AiToolCallResult, JsonObject } from '../../../../../../shared/types'
import type { PdfOpenResult } from '../../../../pdf/types'
import { getPdfWorkerClient } from '../../../../pdf/worker/pdfWorkerClient'
import type { PdfWorkerRequest, PdfWorkerResponse } from '../../../../pdf/worker/types'
import { resolveToolPath } from '../terminal/commandPolicy'
import { createToolEventEmitter } from '../utils/toolEvents'
import type { ToolEventEmitter } from '../utils/toolEvents'
import type { PdfCapabilityToolsInput } from './types'

type FailedPdfWorkerResponse = Extract<PdfWorkerResponse, { ok: false }>

export class PdfToolRuntimeError extends Error {
  public readonly reason: FailedPdfWorkerResponse['code']

  public constructor(response: FailedPdfWorkerResponse) {
    super(response.error)
    this.name = 'PdfToolRuntimeError'
    this.reason = response.code
  }
}

export type PdfToolResourceContext = {
  family: 'pdf'
  sourcePath: string
  effectKind: 'inspected' | 'searched' | 'read'
}

export type PdfToolFailure = {
  ok: false
  error: string
  decisionHint?: JsonObject
  resourceContext?: PdfToolResourceContext
}

export type PdfReadSession = PdfOpenResult

export type PdfToolRuntime = {
  input: PdfCapabilityToolsInput
  workspaceRootPath: string
  toolEvents: ToolEventEmitter
  resolvePdfPath: (rawPath: string) => Promise<string>
  ensureDocument: (sourcePath: string) => Promise<PdfReadSession>
  callWorker: (request: Omit<PdfWorkerRequest, 'requestId' | 'runId'>) => Promise<PdfWorkerResponse>
  buildResourceContext: (
    sourcePath: string,
    effectKind: PdfToolResourceContext['effectKind']
  ) => PdfToolResourceContext
  emitFailure: (input: {
    toolName: string
    toolCallId: string
    error: string
    reason: string
    decisionHint?: JsonObject
    resourceContext?: PdfToolResourceContext
  }) => PdfToolFailure
  emitWorkerFailure: (input: {
    toolName: string
    toolCallId: string
    response: FailedPdfWorkerResponse
    resourceContext?: PdfToolResourceContext
  }) => PdfToolFailure
  emitSuccess: (input: {
    toolName: string
    toolCallId: string
    result: JsonObject
    resourceContext: PdfToolResourceContext
  }) => void
}

const buildPdfToolCallResult = (input: {
  toolName: string
  ok: boolean
  data: AiToolCallResult['data']
  resourceContext?: PdfToolResourceContext
  error?: string
}): AiToolCallResult => ({
  toolName: input.toolName,
  ok: input.ok,
  data: input.data,
  resourceContext: input.resourceContext
})

export const createPdfToolRuntime = (input: PdfCapabilityToolsInput): PdfToolRuntime => {
  const workspaceRootPath = path.resolve(input.workspaceRootPath)
  const sessionBySourcePath = new Map<string, PdfReadSession>()
  const toolEvents = createToolEventEmitter({
    ctx: input.ctx,
    runId: input.runId,
    taskId: input.taskId,
    stage: 'human_hand'
  })

  const callWorker: PdfToolRuntime['callWorker'] = async (request) =>
    await getPdfWorkerClient().call({ ...request, runId: input.runId } as PdfWorkerRequest)

  const resolvePdfPath = async (rawPath: string): Promise<string> => {
    const lexicalPath = resolveToolPath(rawPath)
    if (!lexicalPath) throw new Error('PDF 路径无效')
    if (path.extname(lexicalPath).toLowerCase() !== '.pdf')
      throw new Error('sourcePath 必须是 .pdf 文件')

    const realSourcePath = await fs.realpath(lexicalPath)
    if (path.extname(realSourcePath).toLowerCase() !== '.pdf')
      throw new Error('sourcePath 必须是 .pdf 文件')
    const stat = await fs.stat(realSourcePath)
    if (!stat.isFile()) throw new Error('sourcePath 不是文件')
    const handle = await fs.open(realSourcePath, 'r')
    try {
      const header = Buffer.alloc(5)
      const { bytesRead } = await handle.read(header, 0, header.length, 0)
      if (bytesRead !== 5 || header.toString('ascii') !== '%PDF-') {
        throw new Error('文件头无效，不是可读取的 PDF')
      }
    } finally {
      await handle.close()
    }
    return realSourcePath
  }

  const ensureDocument = async (rawSourcePath: string): Promise<PdfReadSession> => {
    const sourcePath = await resolvePdfPath(rawSourcePath)
    const cached = sessionBySourcePath.get(sourcePath)
    if (cached) return cached
    const response = await callWorker({ action: 'open', payload: { sourcePath } })
    if (!response.ok) throw new PdfToolRuntimeError(response)
    if (response.payload.action !== 'open') throw new Error('PDF worker 协议错误（open）')
    const session: PdfReadSession = response.payload
    sessionBySourcePath.set(sourcePath, session)
    return session
  }

  const buildResourceContext: PdfToolRuntime['buildResourceContext'] = (
    sourcePath,
    effectKind
  ) => ({ family: 'pdf', sourcePath, effectKind })

  const emitFailure: PdfToolRuntime['emitFailure'] = (params) => {
    const failure: PdfToolFailure = {
      ok: false,
      error: params.error,
      decisionHint: params.decisionHint,
      resourceContext: params.resourceContext
    }
    toolEvents.emitResult({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      error: params.error,
      result: buildPdfToolCallResult({
        toolName: params.toolName,
        ok: false,
        data: failure,
        resourceContext: params.resourceContext,
        error: params.error
      })
    })
    return failure
  }

  const emitWorkerFailure: PdfToolRuntime['emitWorkerFailure'] = (params) =>
    emitFailure({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      error: params.response.error,
      reason: params.response.code,
      resourceContext: params.resourceContext
    })

  const emitSuccess: PdfToolRuntime['emitSuccess'] = (params) => {
    toolEvents.emitResult({
      toolName: params.toolName,
      toolCallId: params.toolCallId,
      result: buildPdfToolCallResult({
        toolName: params.toolName,
        ok: true,
        data: params.result,
        resourceContext: params.resourceContext
      })
    })
  }

  return {
    input,
    workspaceRootPath,
    toolEvents,
    resolvePdfPath,
    ensureDocument,
    callWorker,
    buildResourceContext,
    emitFailure,
    emitWorkerFailure,
    emitSuccess
  }
}
