import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import type { DocxOutlineBlock, DocxSearchMatch, DocxValidationProblem } from '../types'
import { applyDocxOps } from '../adapters/ooxml/opExecutor'
import {
  buildBlockIndex,
  buildOutlineOutput,
  extractBlockText,
  getDetailedBlock,
  loadDocxBundle,
  toOpenStats
} from '../adapters/ooxml/blockIndex'
import { validateDocxBuffer } from '../adapters/ooxml/validator'
import { normalizeDocxSearchText } from '../utils/searchText'
import type { DocSnapshot, DocxWorkerRequest, DocxWorkerResponse, RunSessions } from './types'

const sessions: RunSessions = new Map()

const messageText = (error: Error | string): string => {
  return error instanceof Error ? error.message : String(error)
}

const getRunSession = (runId: string, create: boolean): Map<string, DocSnapshot> | null => {
  const existing = sessions.get(runId)
  if (existing) return existing
  if (!create) return null
  const created = new Map<string, DocSnapshot>()
  sessions.set(runId, created)
  return created
}

const getSnapshot = (runId: string, docId: string): DocSnapshot => {
  const runSession = getRunSession(runId, false)
  if (!runSession) throw new Error(`run session not found: ${runId}`)
  const snapshot = runSession.get(docId)
  if (!snapshot) throw new Error(`doc not found: ${docId}`)
  return snapshot
}

const replaceAllOffsets = (text: string, query: string): Array<{ start: number; end: number }> => {
  const offsets: Array<{ start: number; end: number }> = []
  if (!query) return offsets
  let cursor = 0
  for (;;) {
    const index = text.indexOf(query, cursor)
    if (index < 0) break
    offsets.push({ start: index, end: index + query.length })
    cursor = index + Math.max(1, query.length)
  }
  return offsets
}

const normalizeRegexPattern = (pattern: string): string =>
  String(pattern || '').normalize('NFKC')

const regexOffsets = (text: string, pattern: string): Array<{ start: number; end: number }> => {
  const offsets: Array<{ start: number; end: number }> = []
  const regExp = new RegExp(normalizeRegexPattern(pattern), 'g')
  for (;;) {
    const match = regExp.exec(text)
    if (!match) break
    const matchedText = String(match[0] || '')
    offsets.push({
      start: match.index,
      end: match.index + matchedText.length
    })
    if (matchedText.length === 0) regExp.lastIndex += 1
  }
  return offsets
}

const searchBlocks = (input: {
  blocks: DocxOutlineBlock[]
  blockText: (blockId: string) => string
  query: string
  mode: 'literal' | 'regex'
  scopeBlockIds: string[]
}): DocxSearchMatch[] => {
  const scope = input.scopeBlockIds.length > 0 ? new Set(input.scopeBlockIds) : null
  const out: DocxSearchMatch[] = []

  for (const block of input.blocks) {
    if (scope && !scope.has(block.blockId)) continue
    const text = input.blockText(block.blockId)
    const normalizedText = normalizeDocxSearchText(text)
    if (!normalizedText) continue
    const normalizedQuery =
      input.mode === 'literal'
        ? normalizeDocxSearchText(input.query)
        : normalizeRegexPattern(input.query)
    const offsets =
      input.mode === 'literal'
        ? replaceAllOffsets(normalizedText, normalizedQuery)
        : regexOffsets(normalizedText, normalizedQuery)
    if (offsets.length === 0) continue
    out.push({
      blockId: block.blockId,
      text,
      offsets
    })
  }
  return out
}

export const handleDocxWorkerRequest = async (
  request: DocxWorkerRequest
): Promise<DocxWorkerResponse> => {
  try {
    if (request.action === 'release_run') {
      const runSession = getRunSession(request.runId, false)
      const releasedDocCount = runSession ? runSession.size : 0
      sessions.delete(request.runId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'release_run',
          releasedDocCount
        }
      }
    }

    if (request.action === 'open') {
      const buffer = await fs.readFile(request.payload.sourcePath)
      const bundle = await loadDocxBundle(buffer)
      const index = buildBlockIndex(bundle.documentDom)
      const stats = toOpenStats(index, bundle.imageCount)
      const runSession = getRunSession(request.runId, true)
      if (!runSession) {
        throw new Error(`cannot create run session: ${request.runId}`)
      }
      const docId = randomUUID()
      runSession.set(docId, {
        docId,
        sourcePath: request.payload.sourcePath,
        createdAt: Date.now(),
        buffer
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'open',
          docId,
          meta: bundle.meta,
          stats
        }
      }
    }

    if (request.action === 'outline') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const bundle = await loadDocxBundle(snapshot.buffer)
      const index = buildBlockIndex(bundle.documentDom)
      const outline = buildOutlineOutput(index, {
        maxBlocks: request.payload.maxBlocks,
        includeTables: request.payload.includeTables,
        includeCells: request.payload.includeCells
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'outline',
          blocks: outline.blocks,
          truncated: outline.truncated
        }
      }
    }

    if (request.action === 'get_block') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const bundle = await loadDocxBundle(snapshot.buffer)
      const index = buildBlockIndex(bundle.documentDom)
      const block = getDetailedBlock(index, request.payload.blockId)
      if (!block) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `block not found: ${request.payload.blockId}`
        }
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_block',
          block
        }
      }
    }

    if (request.action === 'search') {
      if (request.payload.mode === 'semantic') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'semantic search is not implemented in this version',
          warnings: ['semantic mode is reserved for a future release']
        }
      }
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const bundle = await loadDocxBundle(snapshot.buffer)
      const index = buildBlockIndex(bundle.documentDom)
      const mode = request.payload.mode
      if (mode === 'regex') {
        try {
          void new RegExp(normalizeRegexPattern(request.payload.query))
        } catch {
          return {
            requestId: request.requestId,
            ok: false,
            code: 'invalid_input',
            error: 'invalid regex pattern'
          }
        }
      }
      const matches = searchBlocks({
        blocks: index.outline,
        blockText: (blockId) => extractBlockText(index, blockId),
        query: request.payload.query,
        mode,
        scopeBlockIds: request.payload.scopeBlockIds
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'search',
          matches,
          warnings: []
        }
      }
    }

    if (request.action === 'apply_ops') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const applied = await applyDocxOps({
        buffer: snapshot.buffer,
        ops: request.payload.ops
      })
      const runSession = getRunSession(request.runId, true)
      if (!runSession) throw new Error(`run session missing: ${request.runId}`)
      const newDocId = randomUUID()
      runSession.set(newDocId, {
        docId: newDocId,
        sourcePath: snapshot.sourcePath,
        createdAt: Date.now(),
        parentDocId: snapshot.docId,
        buffer: applied.buffer
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'apply_ops',
          newDocId,
          changedBlocks: applied.changedBlocks,
          warnings: applied.warnings
        }
      }
    }

    if (request.action === 'render_preview') {
      if (request.payload.format !== 'html') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `${request.payload.format} preview is not implemented`,
          warnings: ['only html preview is supported in this version']
        }
      }
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      await fs.mkdir(path.dirname(request.payload.previewPath), { recursive: true })
      await fs.writeFile(request.payload.previewPath, snapshot.buffer)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'render_preview',
          format: request.payload.format,
          previewPath: request.payload.previewPath,
          renderer: 'docx_file_artifact'
        }
      }
    }

    if (request.action === 'save') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      await fs.mkdir(path.dirname(request.payload.outPath), { recursive: true })
      await fs.writeFile(request.payload.outPath, snapshot.buffer)
      const checksum = createHash('sha256').update(snapshot.buffer).digest('hex')
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'save',
          outPath: request.payload.outPath,
          checksum,
          byteSize: snapshot.buffer.byteLength
        }
      }
    }

    const snapshot = getSnapshot(request.runId, request.payload.docId)
    const problems: DocxValidationProblem[] = await validateDocxBuffer(snapshot.buffer)
    return {
      requestId: request.requestId,
      ok: true,
      payload: {
        action: 'validate',
        problems
      }
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      ok: false,
      code: 'failed',
      error: messageText(error instanceof Error ? error : String(error))
    }
  }
}

if (parentPort) {
  parentPort.on('message', async (request: DocxWorkerRequest) => {
    const response = await handleDocxWorkerRequest(request)
    parentPort?.postMessage(response)
  })
}
