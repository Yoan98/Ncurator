import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { extractLegacyDocBody, splitLegacyDocParagraphs } from '../utils/legacyDocReader'
import type { DocxDetailedBlock, DocxOp, DocxOutlineBlock, DocxSearchMatch } from '../types'
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
import { findNewDocxValidationProblems, validateDocxBuffer } from '../adapters/ooxml/validator'
import { normalizeDocxSearchText } from '../utils/searchText'
import type { DocSnapshot, DocxWorkerRequest, DocxWorkerResponse, RunSessions } from './types'
import {
  createInitialIdentityIndex,
  createNextIdentityIndex,
  resolveInternalBlockId,
  resolveInternalVisualId,
  toInternalOp,
  toPublicChangedBlocks,
  toPublicDetailedBlock,
  toPublicOutlineBlock,
  toPublicSearchMatch
} from './identity'

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
  previousSnapshot?: DocSnapshot
  publicOps?: DocxOp[]
}): Promise<DocSnapshot> => {
  const bundle = await loadDocxBundle(input.buffer)
  const index = buildBlockIndex(
    bundle.documentDom,
    bundle.relationshipTargets,
    bundle.relationshipTypes,
    bundle.relationshipTargetModes,
    bundle.availableRelationshipTargetIds
  )
  const baselineValidationProblems =
    input.previousSnapshot?.format === 'docx'
      ? input.previousSnapshot.baselineValidationProblems
      : await validateDocxBuffer(input.buffer)
  const identity = input.previousSnapshot
    ? createNextIdentityIndex({
        previousIndex: input.previousSnapshot.index,
        previousIdentity: input.previousSnapshot.identity,
        nextIndex: index,
        publicOps: input.publicOps || []
      })
    : createInitialIdentityIndex(index)
  return {
    format: 'docx',
    docId: input.docId,
    sourcePath: input.sourcePath,
    createdAt: input.createdAt || Date.now(),
    parentDocId: input.parentDocId,
    buffer: input.buffer,
    checksum: createHash('sha256').update(input.buffer).digest('hex'),
    bundle,
    baselineValidationProblems,
    meta: bundle.meta,
    index,
    identity,
    detailByBlockId: new Map<string, DocxDetailedBlock>()
  }
}

const DEFAULT_LEGACY_DOC_META = {
  title: '',
  creator: '',
  lastModifiedBy: '',
  description: '',
  defaultFont: ''
}

const escapeXmlText = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')

const buildLegacyDocumentDom = (body: string): Document => {
  const paragraphs = splitLegacyDocParagraphs(body)
  const paragraphXml = paragraphs
    .map(
      (paragraph) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(paragraph)}</w:t></w:r></w:p>`
    )
    .join('')
  const xml =
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:body>${paragraphXml}<w:sectPr/></w:body></w:document>`
  return new DOMParser().parseFromString(xml, 'application/xml')
}

const createLegacyDocSnapshot = async (input: {
  docId: string
  sourcePath: string
  createdAt?: number
  buffer: Buffer
}): Promise<DocSnapshot> => {
  const body = await extractLegacyDocBody(input.buffer)
  const index = buildBlockIndex(buildLegacyDocumentDom(body))
  return {
    format: 'doc',
    docId: input.docId,
    sourcePath: input.sourcePath,
    createdAt: input.createdAt || Date.now(),
    buffer: input.buffer,
    checksum: createHash('sha256').update(input.buffer).digest('hex'),
    meta: DEFAULT_LEGACY_DOC_META,
    index,
    identity: createInitialIdentityIndex(index),
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

const getDetailedBlockCached = (
  snapshot: DocSnapshot,
  blockId: string
): DocxDetailedBlock | null => {
  const cached = snapshot.detailByBlockId.get(blockId)
  if (cached) return cached
  const internalId = resolveInternalBlockId(snapshot.identity, blockId)
  const detail = getDetailedBlock(snapshot.index, internalId)
  if (!detail) return null
  const publicDetail = toPublicDetailedBlock(snapshot.identity, detail)
  snapshot.detailByBlockId.set(blockId, publicDetail)
  return publicDetail
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
    .filter(
      (block) =>
        block.type !== 'table_cell' && block.blockIndex >= start && block.blockIndex <= end
    )
    .map((block) => toPublicOutlineBlock(snapshot.identity, block).blockId)
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
    const internalBlockId = resolveInternalBlockId(input.snapshot.identity, block.blockId)
    const text = extractBlockText(input.snapshot.index, internalBlockId)
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
    const structureFacts = getBlockStructureFacts(input.snapshot.index, internalBlockId)
    if (!structureFacts) continue
    out.push(
      toPublicSearchMatch(input.snapshot.identity, {
        blockId: internalBlockId,
        type: structureFacts.blockType,
        blockIndex: structureFacts.blockIndex,
        matchedText: input.query,
        previousBlockId: structureFacts.previousBlockId,
        nextBlockId: structureFacts.nextBlockId,
        tableBlockId: structureFacts.tableBlockId,
        text,
        offsets
      })
    )
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
      const snapshot =
        path.extname(request.payload.sourcePath).toLowerCase() === '.doc'
          ? await createLegacyDocSnapshot({
              docId,
              sourcePath: request.payload.sourcePath,
              buffer
            })
          : await createDocSnapshot({
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
          meta: snapshot.meta,
          stats: toOpenStats(snapshot.index),
          checksum: snapshot.checksum,
          byteSize: snapshot.buffer.byteLength
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
          blocks: outline.blocks.map((block) => toPublicOutlineBlock(snapshot.identity, block))
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

    if (request.action === 'get_replay_snapshot_xml') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const serializer = new XMLSerializer()
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_replay_snapshot_xml',
          blocks: [...snapshot.index.nodesById.entries()].map(([internalBlockId, node]) => {
            const blockId = snapshot.identity.publicIdByInternalId.get(internalBlockId)
            if (!blockId)
              throw new Error(`docx identity missing for internal block: ${internalBlockId}`)
            return { blockId, rawXml: serializer.serializeToString(node.node) }
          })
        }
      }
    }

    if (request.action === 'search') {
      if (request.payload.mode === 'semantic') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'semantic search is not implemented in this worker'
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
        blocks: snapshot.index.outline.map((block) =>
          toPublicOutlineBlock(snapshot.identity, block)
        ),
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
          matches
        }
      }
    }

    if (request.action === 'get_visual') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      if (snapshot.format !== 'docx') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'docx_read_visuals does not support legacy .doc files'
        }
      }
      const internalVisualId = resolveInternalVisualId(snapshot.identity, request.payload.visualId)
      const visual = snapshot.index.visualsById.get(internalVisualId)
      if (!visual) throw new Error(`visual not found: ${request.payload.visualId}`)
      if ((visual.kind !== 'image' && visual.kind !== 'embedded_object') || !visual.target) {
        const owner = snapshot.index.nodesById.get(visual.blockId)
        if (!owner) throw new Error(`visual owner block not found: ${request.payload.visualId}`)
        const visualsInBlock = [...snapshot.index.visualsById.entries()].filter(([, candidate]) => {
          const candidateOwner = snapshot.index.nodesById.get(candidate.blockId)
          return candidateOwner?.blockIndex === owner.blockIndex
        })
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            visualId: request.payload.visualId,
            kind: visual.kind,
            render: {
              blockIndex: owner.blockIndex,
              visualIndexInBlock: visualsInBlock.findIndex(([id]) => id === internalVisualId),
              visualCountInBlock: visualsInBlock.length
            }
          }
        }
      }
      const target = path.posix.normalize(path.posix.join('word', visual.target))
      const file = snapshot.bundle.zip.file(target)
      if (!file) {
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            visualId: request.payload.visualId,
            kind: visual.kind,
            error: `visual media is missing: ${target}`
          }
        }
      }
      const extension = path.posix.extname(target).toLowerCase()
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp',
        '.tif': 'image/tiff',
        '.tiff': 'image/tiff'
      }
      const mimeType = mimeTypes[extension]
      if (!mimeType) {
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            visualId: request.payload.visualId,
            kind: visual.kind,
            error: `unsupported visual media type: ${extension || 'unknown'}`
          }
        }
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_visual',
          visualId: request.payload.visualId,
          kind: visual.kind,
          data: await file.async('nodebuffer'),
          mimeType
        }
      }
    }

    if (request.action === 'apply_ops') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      if (snapshot.format !== 'docx') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'docx_edit does not support writing legacy .doc files'
        }
      }
      const internalOps = request.payload.ops.map((op) => toInternalOp(snapshot.identity, op))
      const applied = await applyDocxOps({
        buffer: snapshot.buffer,
        ops: internalOps
      })
      const validationProblems = findNewDocxValidationProblems(
        snapshot.baselineValidationProblems,
        await validateDocxBuffer(applied.buffer)
      )
      if (validationProblems.length > 0) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'failed',
          error: `apply_ops introduced invalid docx structure: ${validationProblems.map((problem) => problem.message).join('; ')}`
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
        buffer: applied.buffer,
        previousSnapshot: snapshot,
        publicOps: request.payload.ops
      })
      runSession.set(newDocId, nextSnapshot)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'apply_ops',
          newDocId,
          stats: toOpenStats(nextSnapshot.index),
          changedBlocks: toPublicChangedBlocks({
            changedBlocks: applied.changedBlocks,
            previousIdentity: snapshot.identity,
            nextIdentity: nextSnapshot.identity
          })
        }
      }
    }

    if (request.action === 'materialize_draft') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      if (snapshot.format !== 'docx') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'docx_edit does not support writing legacy .doc files'
        }
      }
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
