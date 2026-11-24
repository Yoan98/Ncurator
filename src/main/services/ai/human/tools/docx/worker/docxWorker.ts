import { indexAnnotations } from '../adapters/ooxml/annotations'
import { readAnnotationRecords } from './readAnnotationRecords'
import { buildSectionIndex, sectionsFor } from '../adapters/ooxml/sections'

import type { JsonObject } from '../../../../../../../shared/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import { DOMParser } from '@xmldom/xmldom'
import { extractLegacyDocBody, splitLegacyDocParagraphs } from '../utils/legacyDocReader'
import type { DocxDetailedNode, DocxOperation, DocxOutlineNode, DocxSearchMatch } from '../types'
import {
  DOCX_SEARCH_CONTEXT_NODE_COUNT,
  DOCX_SEARCH_MAX_MATCHES,
  DOCX_SEARCH_NEIGHBOR_PREVIEW_CHARS,
  DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS
} from '../constants'
import { buildDocxSegmentMap } from '../segmentMap'
import {
  privateSlotPart,
  applyDocxOps,
  validateDocxOperationTargets
} from '../adapters/ooxml/opExecutor'
import {
  buildNodeIndex,
  buildDocumentNodeIndex,
  buildOutlineOutput,
  extractNodeText,
  getNodeStructureFacts,
  getDetailedNode,
  loadDocxBundle,
  toOpenStats
} from '../adapters/ooxml/nodeIndex'
import { findNewDocxValidationProblems, validateDocxBuffer } from '../adapters/ooxml/validator'
import { resolveDocxRelationshipTarget } from '../adapters/ooxml/relationshipPath'
import { isRootNode, isVisualNode } from '../adapters/ooxml/types'
import type { DocSnapshot, DocxWorkerRequest, DocxWorkerResponse, RunSessions } from './types'
import {
  bindIdentity,
  createInitialIdentityIndex,
  createNextIdentityIndex,
  resolveInternalNodeId,
  resolveInternalVisualNodeId,
  toInternalOp,
  toPublicChangedNodes,
  toPublicDetailedNode,
  toPublicOutlineNode,
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

function annotationIdsByNode(
  bundle: Awaited<ReturnType<typeof loadDocxBundle>>,
  index: ReturnType<typeof buildDocumentNodeIndex>
) {
  const ids = new Map<string, { commentIds?: string[]; revisionIds?: string[] }>()
  const { comments, revisions } = indexAnnotations(bundle, index)
  const mark = (anchors: string[], id: string, key: 'revisionIds' | 'commentIds') => {
    for (const anchor of anchors) {
      const entry = index.nodesById.get(anchor)
      const root = entry && 'ownerNodeId' in entry ? entry.ownerNodeId : anchor
      for (const target of new Set([anchor, root])) {
        const record = ids.get(target) ?? {}
        const refs = (record[key] ??= [])
        if (!refs.includes(id)) refs.push(id)
        ids.set(target, record)
      }
    }
  }
  for (const [id, c] of comments) mark(c.anchorNodeIds, id, 'commentIds')
  for (const [id, c] of revisions) mark(c.record.anchorNodeIds, id, 'revisionIds')
  return ids
}

const createDocSnapshot = async (input: {
  docId: string
  sourcePath: string
  createdAt?: number
  parentDocId?: string
  buffer: Buffer
  previousSnapshot?: DocSnapshot
  publicOps?: DocxOperation[]
}): Promise<DocSnapshot> => {
  const bundle = await loadDocxBundle(input.buffer)
  const index = buildDocumentNodeIndex(bundle)
  const baselineValidationProblems =
    input.previousSnapshot?.format === 'docx'
      ? input.previousSnapshot.baselineValidationProblems
      : await validateDocxBuffer(input.buffer)
  const identity = input.previousSnapshot
    ? createNextIdentityIndex({
        previousIndex: input.previousSnapshot.index,
        previousBundle:
          input.previousSnapshot.format === 'docx' ? input.previousSnapshot.bundle : undefined,
        previousIdentity: input.previousSnapshot.identity,
        nextIndex: index,
        publicOps: input.publicOps || []
      })
    : createInitialIdentityIndex(index)
  const structure = buildSectionIndex(bundle, index, (key) =>
    bindIdentity(identity, key, input.previousSnapshot?.identity.publicIdByInternalId.get(key))
  )
  return {
    format: 'docx',
    structure,
    aliases: new Map(input.previousSnapshot?.aliases),
    annotationIds: annotationIdsByNode(bundle, index),
    docId: input.docId,
    sourcePath: input.sourcePath,
    createdAt: input.createdAt || Date.now(),
    parentDocId: input.parentDocId,
    buffer: input.buffer,
    checksum: createHash('sha256').update(input.buffer).digest('hex'),
    bundle,
    baselineValidationProblems,
    index,
    identity,
    detailByNodeId: new Map<string, DocxDetailedNode>()
  }
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
  const index = buildNodeIndex(buildLegacyDocumentDom(body))
  return {
    format: 'doc',
    docId: input.docId,
    sourcePath: input.sourcePath,
    createdAt: input.createdAt || Date.now(),
    buffer: input.buffer,
    checksum: createHash('sha256').update(input.buffer).digest('hex'),
    index,
    identity: createInitialIdentityIndex(index),
    detailByNodeId: new Map<string, DocxDetailedNode>()
  }
}

const getSnapshot = (runId: string, docId: string): DocSnapshot => {
  const runSession = getRunSession(runId, false)
  if (!runSession) throw new Error(`run session not found: ${runId}`)
  const snapshot = runSession.get(docId)
  if (!snapshot) throw new Error(`doc not found: ${docId}`)
  return snapshot
}

const scopeSeparator = '@'
function scopeContent<T extends { nodeId?: string; children?: object[] }>(
  node: T,
  slot: string
): T {
  return {
    ...node,
    ...(node.nodeId ? { nodeId: slot + scopeSeparator + node.nodeId } : {}),
    ...('tableNodeId' in node ? { tableNodeId: slot + scopeSeparator + node.tableNodeId } : {}),
    ...(node.children ? { children: node.children.map((child) => scopeContent(child, slot)) } : {})
  }
}
const getDetailedNodeCached = (snapshot: DocSnapshot, nodeId: string): DocxDetailedNode | null => {
  const cached = snapshot.detailByNodeId.get(nodeId)
  if (cached) return cached
  const [first, canonical] = nodeId.split(scopeSeparator)
  const internal = resolveInternalNodeId(
    snapshot.identity,
    snapshot.aliases?.get(nodeId) ?? canonical ?? first!
  )
  if (
    canonical &&
    snapshot.structure?.slots.get(first!)?.partName !==
      snapshot.index.nodesById.get(internal)?.partName
  )
    throw new Error('invalid scoped target')
  const detail = getDetailedNode(snapshot.index, internal)
  if (!detail) return null
  const ids = snapshot.annotationIds?.get(internal)
  let node = toPublicDetailedNode(snapshot.identity, { ...detail, ...ids })
  if (canonical) node = { ...scopeContent(node, first!), nodeId }
  snapshot.detailByNodeId.set(nodeId, node)
  return node
}

const getDetailedNodesByIds = (
  snapshot: DocSnapshot,
  nodeIds: readonly string[]
): DocxDetailedNode[] => {
  const nodes: DocxDetailedNode[] = []
  for (const nodeId of nodeIds) {
    const detail = getDetailedNodeCached(snapshot, nodeId)
    if (detail) {
      nodes.push(detail)
    }
  }
  return nodes
}

const getDetailedNodesByNodeIndexRange = (
  snapshot: DocSnapshot,
  fromNodeIndex: number,
  toNodeIndex: number
): DocxDetailedNode[] => {
  const start = Math.max(0, Math.min(fromNodeIndex, toNodeIndex))
  const end = Math.max(0, Math.max(fromNodeIndex, toNodeIndex))
  const nodeIds = snapshot.index.outline
    .filter(
      (node) => node.type !== 'table_cell' && node.nodeIndex >= start && node.nodeIndex <= end
    )
    .map((node) => toPublicOutlineNode(snapshot.identity, node).nodeId)
  return getDetailedNodesByIds(snapshot, nodeIds)
}

type TextMatchOffset = { start: number; end: number }

type TextMatchScan = {
  totalMatchCount: number
  offsets: TextMatchOffset[]
}

const scanLiteralMatches = (text: string, query: string, collectLimit: number): TextMatchScan => {
  const offsets: Array<{ start: number; end: number }> = []
  if (!query) return { totalMatchCount: 0, offsets }
  let totalMatchCount = 0
  let cursor = 0
  for (;;) {
    const index = text.indexOf(query, cursor)
    if (index < 0) break
    totalMatchCount += 1
    if (offsets.length < collectLimit) {
      offsets.push({ start: index, end: index + query.length })
    }
    cursor = index + Math.max(1, query.length)
  }
  return { totalMatchCount, offsets }
}

const normalizeRegexPattern = (pattern: string): string => String(pattern || '')

const scanRegexMatches = (text: string, pattern: string, collectLimit: number): TextMatchScan => {
  const offsets: Array<{ start: number; end: number }> = []
  const regExp = new RegExp(normalizeRegexPattern(pattern), 'g')
  let totalMatchCount = 0
  for (;;) {
    const match = regExp.exec(text)
    if (!match) break
    const matchedText = String(match[0] || '')
    totalMatchCount += 1
    if (offsets.length < collectLimit) {
      offsets.push({
        start: match.index,
        end: match.index + matchedText.length
      })
    }
    if (matchedText.length === 0) regExp.lastIndex += 1
  }
  return { totalMatchCount, offsets }
}

const searchNodes = (input: {
  nodes: DocxOutlineNode[]
  snapshot: DocSnapshot
  query: string
  mode: 'literal' | 'regex'
  scopeNodeIds: string[]
  includeContext: boolean
}): { totalMatchCount: number; matches: DocxSearchMatch[] } => {
  const scope = input.scopeNodeIds.length > 0 ? new Set(input.scopeNodeIds) : null
  const out: DocxSearchMatch[] = []
  let totalMatchCount = 0

  const searchableNodes = input.nodes.filter((node) => {
    if (scope) return scope.has(node.nodeId)
    return node.type !== 'table'
  })
  const contextNodes = input.nodes.filter(
    (node) => node.type !== 'table' || scope?.has(node.nodeId)
  )

  const preview = (text: string): string => {
    const normalized = text.replace(/\s+/gu, ' ').trim()
    const values = Array.from(normalized)
    if (values.length <= DOCX_SEARCH_NEIGHBOR_PREVIEW_CHARS) return normalized
    const head = Math.ceil((DOCX_SEARCH_NEIGHBOR_PREVIEW_CHARS - 1) / 2)
    return `${values.slice(0, head).join('')}…${values
      .slice(-(DOCX_SEARCH_NEIGHBOR_PREVIEW_CHARS - head - 1))
      .join('')}`
  }

  const centeredContext = (text: string, start: number, end: number): string => {
    const values = Array.from(text)
    if (values.length <= DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS) return text
    const charStart = Array.from(text.slice(0, start)).length
    const charEnd = charStart + Array.from(text.slice(start, end)).length
    const center = Math.floor((charStart + charEnd) / 2)
    let from = Math.max(0, center - Math.floor(DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS / 2))
    let to = Math.min(values.length, from + DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS)
    from = Math.max(0, to - DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS)
    const prefix = from > 0 ? '…' : ''
    const suffix = to < values.length ? '…' : ''
    const contentBudget = DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS - Array.from(prefix + suffix).length
    if (to - from > contentBudget) {
      const excess = to - from - contentBudget
      from += Math.floor(excess / 2)
      to -= Math.ceil(excess / 2)
    }
    return `${prefix}${values.slice(from, to).join('')}${suffix}`
  }

  const neighbor = (node: DocxOutlineNode) => ({
    nodeId: resolveInternalNodeId(input.snapshot.identity, node.nodeId),
    nodeIndex: node.nodeIndex,
    type: node.type,
    textPreview: preview(node.text)
  })

  for (const node of searchableNodes) {
    const internalNodeId = resolveInternalNodeId(input.snapshot.identity, node.nodeId)
    const text = extractNodeText(input.snapshot.index, internalNodeId)
    if (!text) continue
    const scan =
      input.mode === 'literal'
        ? scanLiteralMatches(text, input.query, DOCX_SEARCH_MAX_MATCHES - out.length)
        : scanRegexMatches(text, input.query, DOCX_SEARCH_MAX_MATCHES - out.length)
    totalMatchCount += scan.totalMatchCount
    if (scan.offsets.length === 0) continue
    const structureFacts = getNodeStructureFacts(input.snapshot.index, internalNodeId)
    if (!structureFacts) continue
    const storyContextNodes = contextNodes.filter(
      (candidate) => candidate.story.storyId === node.story.storyId
    )
    const contextPosition = storyContextNodes.findIndex(
      (candidate) => candidate.nodeId === node.nodeId
    )
    scan.offsets.forEach((offset) => {
      const before =
        input.includeContext && contextPosition >= 0
          ? storyContextNodes
              .slice(Math.max(0, contextPosition - DOCX_SEARCH_CONTEXT_NODE_COUNT), contextPosition)
              .map(neighbor)
          : undefined
      const after =
        input.includeContext && contextPosition >= 0
          ? storyContextNodes
              .slice(contextPosition + 1, contextPosition + 1 + DOCX_SEARCH_CONTEXT_NODE_COUNT)
              .map(neighbor)
          : undefined
      out.push({
        nodeId: internalNodeId,
        type: structureFacts.nodeType,
        nodeIndex: structureFacts.nodeIndex,
        matchText: text.slice(offset.start, offset.end),
        textContext: centeredContext(text, offset.start, offset.end),
        tableNodeId: structureFacts.tableNodeId,
        story: structureFacts.story,
        ...(before && before.length > 0 ? { before } : {}),
        ...(after && after.length > 0 ? { after } : {})
      })
    })
  }

  return {
    totalMatchCount,
    matches: out.map((match) => toPublicSearchMatch(input.snapshot.identity, match))
  }
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
          stats: toOpenStats(snapshot.index),
          checksum: snapshot.checksum,
          byteSize: snapshot.buffer.byteLength
        }
      }
    }

    if (request.action === 'outline') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const outline = buildOutlineOutput(snapshot.index, {
        fromNodeIndex: request.payload.fromNodeIndex,
        toNodeIndex: request.payload.toNodeIndex,
        includeCells: request.payload.includeCells
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'outline',
          nodes: outline.nodes.map((node) => toPublicOutlineNode(snapshot.identity, node))
        }
      }
    }

    if (request.action === 'read_structure') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const nodes: JsonObject[] = request.payload.nodeIds.map((id) => {
        const section = snapshot.structure?.sections.find((s) => s.nodeId === id)
        if (section) return section
        const slot = snapshot.structure?.slots.get(id)
        if (slot) {
          const children = snapshot.index.outline
            .filter(
              (n) => n.story.storyId === slot.kind + ':' + slot.partName && n.type !== 'table_cell'
            )
            .map((n) => {
              const publicId = snapshot.identity.publicIdByInternalId.get(n.nodeId)!
              return { nodeId: id + scopeSeparator + publicId }
            })
          return {
            ...slot.ref,
            type: slot.kind,
            sectionNodeId: snapshot.structure!.sections[slot.sectionIndex]!.nodeId,
            children
          }
        }
        if (!getDetailedNodeCached(snapshot, id)) throw new Error('unknown node: ' + id)
        return { nodeId: id }
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: { action: 'read_structure', nodes }
      }
    }
    if (request.action === 'segment_map') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'segment_map',
          sectionIds: snapshot.structure?.sections.map((s) => s.nodeId) ?? [],
          segments: buildDocxSegmentMap(
            snapshot.index,
            snapshot.format === 'docx' ? snapshot.bundle : undefined,
            (n) => sectionsFor(snapshot.structure, n.story.storyId, n.nodeIndex)
          )
        }
      }
    }

    if (request.action === 'get_annotations') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      if (snapshot.format !== 'docx') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'annotations are only available for .docx files'
        }
      }
      const records = await readAnnotationRecords(snapshot, request.payload.nodeIds)
      return {
        requestId: request.requestId,
        ok: true,
        payload: { action: 'get_annotations', ...records }
      }
    }

    if (request.action === 'get_node') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const node = getDetailedNodeCached(snapshot, request.payload.nodeId)
      if (!node) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `node not found: ${request.payload.nodeId}`
        }
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_node',
          node
        }
      }
    }

    if (request.action === 'get_node_layout') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const id = request.payload.nodeId
      if (
        snapshot.structure?.slots.has(id) ||
        snapshot.structure?.sections.some((s) => s.nodeId === id)
      )
        return {
          requestId: request.requestId,
          ok: true,
          payload: { action: 'get_node_layout', ownerNodeId: id, layoutMode: 'normal', text: '' }
        }
      const internalId = resolveInternalNodeId(
        snapshot.identity,
        snapshot.aliases?.get(request.payload.nodeId) ??
          request.payload.nodeId.split(scopeSeparator).at(-1)!
      )
      const entry = snapshot.index.nodesById.get(internalId)
      if (!entry) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `node not found: ${request.payload.nodeId}`
        }
      }
      const ownerNodeId = 'ownerNodeId' in entry ? entry.ownerNodeId : entry.nodeId
      const owner = snapshot.index.nodesById.get(ownerNodeId)
      if (!owner || !isRootNode(owner)) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `node owner not found: ${request.payload.nodeId}`
        }
      }
      const publicOwnerNodeId = snapshot.identity.publicIdByInternalId.get(owner.nodeId)
      if (!publicOwnerNodeId) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'failed',
          error: `node identity missing: ${request.payload.nodeId}`
        }
      }
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_node_layout',
          ownerNodeId: publicOwnerNodeId,
          layoutMode: owner.layoutMode,
          text: extractNodeText(snapshot.index, owner.nodeId)
        }
      }
    }

    if (request.action === 'get_nodes_by_ids') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_nodes_by_ids',
          nodes: getDetailedNodesByIds(snapshot, request.payload.nodeIds)
        }
      }
    }

    if (request.action === 'get_nodes_by_index_range') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_nodes_by_index_range',
          nodes: getDetailedNodesByNodeIndexRange(
            snapshot,
            request.payload.fromNodeIndex,
            request.payload.toNodeIndex
          )
        }
      }
    }

    if (request.action === 'search') {
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
      const outline = snapshot.index.outline.map((node) =>
        toPublicOutlineNode(snapshot.identity, node)
      )
      const searchableNodeIds = new Set(outline.map((node) => node.nodeId))
      const selectedSlots = new Map<string, Set<string>>()
      const selectedSectionIds = new Set(request.payload.scopeNodeIds)
      for (const [slotId, slot] of snapshot.structure?.slots ?? []) {
        if (
          !slot.partName ||
          !(
            selectedSectionIds.has(slotId) ||
            selectedSectionIds.has(snapshot.structure!.sections[slot.sectionIndex]!.nodeId)
          )
        )
          continue
        const choices = selectedSlots.get(slot.partName) ?? new Set<string>()
        choices.add(slotId)
        selectedSlots.set(slot.partName, choices)
      }
      const expanded = request.payload.scopeNodeIds.flatMap((id) => {
        if (id.includes(scopeSeparator)) {
          const [scope, canonical] = id.split(scopeSeparator)
          const target = snapshot.aliases?.get(id) ?? canonical!
          const detail = getDetailedNodeCached(snapshot, id)
          if (!detail) throw new Error('unknown search scope')
          const slot = snapshot.structure?.slots.get(scope!)
          if (slot?.partName) selectedSlots.set(slot.partName, new Set([scope!]))
          return [target]
        }
        const slot = snapshot.structure?.slots.get(id)
        if (slot)
          return outline
            .filter((n) => n.story.storyId === slot.kind + ':' + slot.partName)
            .map((n) => n.nodeId)
        if (snapshot.structure?.sections.some((s) => s.nodeId === id))
          return outline
            .filter((n) =>
              sectionsFor(snapshot.structure, n.story.storyId, n.nodeIndex).includes(id)
            )
            .map((n) => n.nodeId)
        return [id]
      })
      if (request.payload.scopeNodeIds.length && !expanded.length)
        return {
          requestId: request.requestId,
          ok: true,
          payload: { action: 'search', totalMatchCount: 0, matches: [] }
        }
      const invalidScopeNodeId = expanded.find((nodeId) => !searchableNodeIds.has(nodeId))
      if (invalidScopeNodeId) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: `stale, unknown, or unsupported search nodeId: ${invalidScopeNodeId}; read the document again`
        }
      }
      const searchResult = searchNodes({
        nodes: outline,
        snapshot,
        query: request.payload.query,
        mode,
        scopeNodeIds: expanded,
        includeContext: request.payload.includeContext
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'search',
          totalMatchCount: searchResult.totalMatchCount,
          matches: searchResult.matches.map((m) => {
            const slots = selectedSlots.get(
              snapshot.index.nodesById.get(resolveInternalNodeId(snapshot.identity, m.nodeId))!
                .partName
            )
            const slot = slots?.size === 1 ? [...slots][0] : undefined
            const prefix = (id: string) => (slot ? slot + scopeSeparator + id : id)
            return {
              ...m,
              nodeId: prefix(m.nodeId),
              tableNodeId: m.tableNodeId ? prefix(m.tableNodeId) : undefined,
              before: m.before?.map((n) => ({ ...n, nodeId: prefix(n.nodeId) })),
              after: m.after?.map((n) => ({ ...n, nodeId: prefix(n.nodeId) })),
              sectionNodeIds: slot
                ? [
                    snapshot.structure!.sections[snapshot.structure!.slots.get(slot)!.sectionIndex]!
                      .nodeId
                  ]
                : sectionsFor(snapshot.structure, m.story.storyId, m.nodeIndex)
            }
          })
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
          error: 'DOCX visual materialization does not support legacy .doc files'
        }
      }
      const internalVisualNodeId = resolveInternalVisualNodeId(
        snapshot.identity,
        snapshot.aliases?.get(request.payload.nodeId) ??
          request.payload.nodeId.split(scopeSeparator).at(-1)!
      )
      const visualEntry = snapshot.index.nodesById.get(internalVisualNodeId)
      if (!visualEntry || !isVisualNode(visualEntry)) {
        throw new Error(`visual not found: ${request.payload.nodeId}`)
      }
      const visual = visualEntry
      if ((visual.kind !== 'image' && visual.kind !== 'embedded_object') || !visual.target) {
        const owner = snapshot.index.nodesById.get(visual.ownerNodeId)
        if (!owner || !isRootNode(owner)) {
          throw new Error(`visual owner node not found: ${request.payload.nodeId}`)
        }
        const visualsInNode = [...snapshot.index.nodesById.entries()].filter(
          (entry): entry is [string, typeof visual] => {
            const candidate = entry[1]
            if (!isVisualNode(candidate)) return false
            const candidateOwner = snapshot.index.nodesById.get(candidate.ownerNodeId)
            return Boolean(
              candidateOwner &&
              isRootNode(candidateOwner) &&
              candidateOwner.nodeIndex === owner.nodeIndex
            )
          }
        )
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            nodeId: request.payload.nodeId,
            kind: visual.kind,
            render: {
              nodeIndex: owner.nodeIndex,
              visualIndexInNode: visualsInNode.findIndex(([id]) => id === internalVisualNodeId),
              visualCountInNode: visualsInNode.length
            }
          }
        }
      }
      const target = resolveDocxRelationshipTarget(visual.target, visual.partName)
      if (!target) throw new Error(`invalid visual relationship target: ${visual.target}`)
      const file = snapshot.bundle.zip.file(target)
      if (!file) {
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            nodeId: request.payload.nodeId,
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
            nodeId: request.payload.nodeId,
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
          nodeId: request.payload.nodeId,
          kind: visual.kind,
          data: await file.async('nodebuffer'),
          mimeType
        }
      }
    }

    if (request.action === 'apply_operations') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      if (snapshot.format !== 'docx') {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'DOCX writing tools do not support legacy .doc files'
        }
      }
      if (request.payload.operations.length === 0) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: 'apply_operations requires at least one operation'
        }
      }
      let base = snapshot
      const publicOps: DocxOperation[] = []
      for (const operation of request.payload.operations) {
        const op = { ...operation }
        for (const key of [
          'nodeId',
          'tableNodeId',
          'rowNodeId',
          'cellNodeId',
          'anchorNodeId'
        ] as const) {
          if (!(key in op)) continue
          const target = Reflect.get(op, key) as string | undefined
          if (!target) continue
          const [scope, canonical] = target.split(scopeSeparator)
          const slot = base.structure?.slots.get(scope!)
          if (!slot) {
            if (op.type === 'create_table' && ['inside_start', 'inside_end'].includes(op.position))
              throw new Error('insert tables inside a header or footer')
            const entry = base.index.nodesById.get(resolveInternalNodeId(base.identity, target))
            if (
              entry &&
              [...base.structure!.slots.values()].filter((s) => s.partName === entry.partName)
                .length > 1
            )
              return {
                requestId: request.requestId,
                ok: false,
                code: 'ambiguous_section',
                sectionNodeIds: sectionsFor(base.structure, entry.story.storyId, 0),
                error: '共享页眉页脚，请按候选节读取后使用节内的节点 ID'
              }
            continue
          }
          let part = slot.partName
          const internal = canonical
            ? resolveInternalNodeId(base.identity, base.aliases?.get(target) ?? canonical)
            : undefined
          if (internal && base.index.nodesById.get(internal)?.partName !== part)
            throw new Error('invalid scoped target')
          if (
            !part ||
            slot.ref.state !== 'local' ||
            [...base.structure!.slots.values()].filter((s) => s.partName === part).length > 1
          ) {
            const isolated = await privateSlotPart(
              base.buffer,
              slot.sectionIndex,
              slot.kind,
              slot.ref.variant,
              part,
              slot.relId
            )
            const original = base
            base = (await createDocSnapshot({
              docId: base.docId,
              sourcePath: base.sourcePath,
              buffer: isolated.buffer,
              previousSnapshot: base
            })) as typeof base
            part = isolated.partName
            if (slot.partName) {
              for (const [oldId, entry] of original.index.nodesById) {
                if (entry.partName !== slot.partName) continue
                const newId = oldId.replace(
                  slot.kind + ':' + slot.partName + ':',
                  slot.kind + ':' + part + ':'
                )
                const previous =
                  original.identity.publicIdByInternalId.get(oldId) ??
                  original.identity.publicNodeIdByInternalId.get(oldId)
                const next =
                  base.identity.publicIdByInternalId.get(newId) ??
                  base.identity.publicNodeIdByInternalId.get(newId)
                if (previous && next) base.aliases!.set(scope + scopeSeparator + previous, next)
              }
            }
          }
          const story = slot.kind + ':' + part
          if (internal) {
            const mapped = internal.replace(slot.kind + ':' + slot.partName + ':', story + ':')
            const id =
              base.identity.publicIdByInternalId.get(mapped) ??
              base.identity.publicNodeIdByInternalId.get(mapped)
            if (!id) throw new Error('cannot resolve copied header/footer target')
            Reflect.set(op, key, id)
          } else {
            if (
              (op.type !== 'insert_nodes' && op.type !== 'create_table') ||
              !['inside_start', 'inside_end'].includes(op.position)
            )
              throw new Error(
                op.type === 'format_paragraph'
                  ? `format_paragraph 需要 paragraph 节点 ID，收到 ${slot.kind} 容器 ID；请读取容器 children 中的段落 ID。`
                  : `${slot.kind} 容器仅支持通过 inside_start 或 inside_end 插入段落或表格；编辑内部内容请使用对应内容节点 ID。`
              )
            const root = 'storyRoot:' + story
            bindIdentity(base.identity, root, root)
            Reflect.set(op, key, root)
          }
        }
        publicOps.push(op)
      }
      const internalOperations = publicOps.map((op) => toInternalOp(base.identity, op))
      try {
        await validateDocxOperationTargets(base.buffer, internalOperations)
      } catch (error) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: error instanceof Error ? error.message : String(error)
        }
      }
      const applied = await applyDocxOps({
        buffer: base.buffer,
        ops: internalOperations
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
          error: `apply_operations introduced invalid docx structure: ${validationProblems.map((problem) => problem.message).join('; ')}`
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
        previousSnapshot: base,
        publicOps
      })
      runSession.set(newDocId, nextSnapshot)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'apply_operations',
          newDocId,
          stats: toOpenStats(nextSnapshot.index),
          ...(request.payload.operations.some(
            (op) =>
              'nodeId' in op &&
              typeof op.nodeId === 'string' &&
              (snapshot.structure?.slots.has(op.nodeId) || op.nodeId.includes(scopeSeparator))
          )
            ? {
                createdNodes: nextSnapshot.index.outline
                  .filter((n) => n.type !== 'table_cell')
                  .map((n) => toPublicOutlineNode(nextSnapshot.identity, n))
                  .filter((n) => !base.identity.internalIdByPublicId.has(n.nodeId))
                  .map((n) => ({ nodeId: n.nodeId, type: n.type }))
              }
            : {}),
          changedNodes: toPublicChangedNodes({
            changedNodes: applied.changedNodes,
            previousIdentity: base.identity,
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
          error: 'DOCX writing tools do not support legacy .doc files'
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
