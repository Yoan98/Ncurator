import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import type { DocxDetailedBlock, DocxOutlineBlock, DocxSearchMatch } from '../types'
import { applyDocxOps } from '../adapters/ooxml/opExecutor'
import {
  buildBlockIndex,
  buildOutlineOutput,
  extractBlockText,
  getBlockStructureFacts,
  getDetailedBlock,
  loadDocxBundle,
  toOpenStats
} from '../adapters/ooxml/blockIndex'
import { validateDocxBuffer } from '../adapters/ooxml/validator'
import { normalizeDocxSearchText } from '../utils/searchText'
import type { DocSnapshot, DocxWorkerRequest, DocxWorkerResponse, RunSessions } from './types'

const sessions: RunSessions = new Map()

const messageText = (error: Error | string): string =>
  error instanceof Error ? error.message : String(error)

const getRunSession = (runId: string, create: boolean): Map<string, DocSnapshot> | null => {
  const existing = sessions.get(runId)
  if (existing) return existing
  if (!create) return null
  const created = new Map<string, DocSnapshot>()
  sessions.set(runId, created)
  return created
}

const createDocSnapshot = async (input: {
  docId: string
  sourcePath: string
  createdAt?: number
  parentDocId?: string
  buffer: Buffer
}): Promise<DocSnapshot> => {
  const bundle = await loadDocxBundle(input.buffer)
  const index = buildBlockIndex(bundle.documentDom)
  return {
    docId: input.docId,
    sourcePath: input.sourcePath,
    createdAt: input.createdAt || Date.now(),
    parentDocId: input.parentDocId,
    buffer: input.buffer,
    bundle,
    index,
    detailByBlockId: new Map<string, DocxDetailedBlock>()
  }
}

const getSnapshot = (runId: string, docId: string): DocSnapshot => {
  const runSession = getRunSession(runId, false)
  if (!runSession) throw new Error(`run session not found: ${runId}`)
  const snapshot = runSession.get(docId)
  if (!snapshot) throw new Error(`doc not found: ${docId}`)
  return snapshot
}

const getDetailedBlockCached = (snapshot: DocSnapshot, blockId: string): DocxDetailedBlock | null => {
  const cached = snapshot.detailByBlockId.get(blockId)
  if (cached) return cached
  const detail = getDetailedBlock(snapshot.index, blockId)
  if (!detail) return null
  snapshot.detailByBlockId.set(blockId, detail)
  return detail
}

const getDetailedBlocksByIds = (
  snapshot: DocSnapshot,
  blockIds: readonly string[]
): DocxDetailedBlock[] => {
  const blocks: DocxDetailedBlock[] = []
  for (const blockId of blockIds) {
    const detail = getDetailedBlockCached(snapshot, blockId)
    if (detail) {
      blocks.push(detail)
    }
  }
  return blocks
}

const getDetailedBlocksByBlockIndexRange = (
  snapshot: DocSnapshot,
  fromBlockIndex: number,
  toBlockIndex: number
): DocxDetailedBlock[] => {
  const start = Math.max(0, Math.min(fromBlockIndex, toBlockIndex))
  const end = Math.max(0, Math.max(fromBlockIndex, toBlockIndex))
  const blockIds = snapshot.index.outline
    .filter((block) => block.blockIndex >= start && block.blockIndex <= end)
    .map((block) => block.blockId)
  return getDetailedBlocksByIds(snapshot, blockIds)
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

const normalizeRegexPattern = (pattern: string): string => String(pattern || '').normalize('NFKC')

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
  snapshot: DocSnapshot
  query: string
  mode: 'literal' | 'regex'
  scopeBlockIds: string[]
}): DocxSearchMatch[] => {
  const scope = input.scopeBlockIds.length > 0 ? new Set(input.scopeBlockIds) : null
  const out: DocxSearchMatch[] = []

  for (const block of input.blocks) {
    if (scope && !scope.has(block.blockId)) continue
    const text = extractBlockText(input.snapshot.index, block.blockId)
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
    const structureFacts = getBlockStructureFacts(input.snapshot.index, block.blockId)
    if (!structureFacts) continue
    out.push({
      blockId: block.blockId,
      type: structureFacts.blockType,
      blockIndex: structureFacts.blockIndex,
      matchedText: input.query,
      previousBlockId: structureFacts.previousBlockId,
      nextBlockId: structureFacts.nextBlockId,
      tableBlockId: structureFacts.tableBlockId,
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
      const docId = randomUUID()
      const snapshot = await createDocSnapshot({
        docId,
        sourcePath: request.payload.sourcePath,
        buffer
      })
      const runSession = getRunSession(request.runId, true)
      if (!runSession) {
        throw new Error(`cannot create run session: ${request.runId}`)
      }
      runSession.set(docId, snapshot)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'open',
          docId,
          meta: snapshot.bundle.meta,
          stats: toOpenStats(snapshot.index, snapshot.bundle.imageCount)
        }
      }
    }

    if (request.action === 'outline') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const outline = buildOutlineOutput(snapshot.index, {
        ranges: request.payload.ranges,
        includeTables: request.payload.includeTables,
        includeCells: request.payload.includeCells
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'outline',
          blocks: outline.blocks
        }
      }
    }

    if (request.action === 'get_block') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const block = getDetailedBlockCached(snapshot, request.payload.blockId)
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

    if (request.action === 'get_blocks_by_ids') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_blocks_by_ids',
          blocks: getDetailedBlocksByIds(snapshot, request.payload.blockIds)
        }
      }
    }

    if (request.action === 'get_blocks_by_block_index_range') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_blocks_by_block_index_range',
          blocks: getDetailedBlocksByBlockIndexRange(
            snapshot,
            request.payload.fromBlockIndex,
            request.payload.toBlockIndex
          )
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
        blocks: snapshot.index.outline,
        snapshot,
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
      const validationProblems = await validateDocxBuffer(applied.buffer)
      if (validationProblems.length > 0) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'failed',
          error: `apply_ops produced invalid docx: ${validationProblems.map((problem) => problem.message).join('; ')}`,
          warnings: validationProblems.map((problem) => `${problem.code}: ${problem.message}`)
        }
      }
      const runSession = getRunSession(request.runId, true)
      if (!runSession) throw new Error(`run session missing: ${request.runId}`)
      const newDocId = randomUUID()
      const nextSnapshot = await createDocSnapshot({
        docId: newDocId,
        sourcePath: snapshot.sourcePath,
        createdAt: Date.now(),
        parentDocId: snapshot.docId,
        buffer: applied.buffer
      })
      runSession.set(newDocId, nextSnapshot)
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

    if (request.action === 'materialize_draft') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      await fs.mkdir(path.dirname(request.payload.outPath), { recursive: true })
      await fs.writeFile(request.payload.outPath, snapshot.buffer)
      const checksum = createHash('sha256').update(snapshot.buffer).digest('hex')
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'materialize_draft',
          outPath: request.payload.outPath,
          checksum,
          byteSize: snapshot.buffer.byteLength
        }
      }
    }

    throw new Error('unknown action')
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
