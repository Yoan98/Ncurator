import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { parentPort } from 'node:worker_threads'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { extractLegacyDocBody, splitLegacyDocParagraphs } from '../utils/legacyDocReader'
import type { DocxDetailedNode, DocxOperation, DocxOutlineNode, DocxSearchMatch } from '../types'
import {
  DOCX_SEARCH_CONTEXT_NODE_COUNT,
  DOCX_SEARCH_MAX_MATCHES,
  DOCX_SEARCH_NEIGHBOR_PREVIEW_CHARS,
  DOCX_SEARCH_SURROUNDING_CONTEXT_CHARS
} from '../constants'
import { buildDocxSegmentMap } from '../segmentMap'
import { applyDocxOps, validateDocxOperationTargets } from '../adapters/ooxml/opExecutor'
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
import type { DocSnapshot, DocxWorkerRequest, DocxWorkerResponse, RunSessions } from './types'
import {
  createInitialIdentityIndex,
  createNextIdentityIndex,
  resolveInternalNodeId,
  resolveInternalVisualId,
  toInternalOp,
  toPublicChangedNodes,
  toPublicDetailedNode,
  toPublicOutlineNode,
  toPublicSearchMatch
} from './identity'

const sessions: RunSessions = new Map()

const localAttribute = (node: Element, name: string): string => {
  for (let index = 0; index < node.attributes.length; index += 1) {
    const attribute = node.attributes.item(index)
    if (attribute?.localName === name) return attribute.value
  }
  return ''
}

const replayModelPart = (name: string): boolean =>
  /^word\/(styles|numbering|settings|comments|commentsExtended|footnotes|endnotes|header\d+|footer\d+)\.xml$/.test(
    name
  ) ||
  /^word\/(media|embeddings|charts)\//.test(name) ||
  /^customXml\//.test(name) ||
  name.endsWith('.rels')

const normalizedReplayPart = (name: string, content: Buffer): Buffer | undefined => {
  if (!name.endsWith('.xml') && !name.endsWith('.rels')) return content
  const xml = content.toString('utf8')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (name === 'word/comments.xml' && doc.getElementsByTagNameNS('*', 'comment').length === 0) {
    return undefined
  }
  if (
    name === 'word/commentsExtended.xml' &&
    doc.getElementsByTagNameNS('*', 'commentEx').length === 0
  ) {
    return undefined
  }
  if (name === 'word/settings.xml' && doc.documentElement.childNodes.length === 0) return undefined
  if (name.endsWith('.rels')) {
    const relationships = Array.from(doc.getElementsByTagNameNS('*', 'Relationship'))
    relationships.forEach((relationship) => {
      const type = relationship.getAttribute('Type') || ''
      if (type.endsWith('/comments') || type.endsWith('/commentsExtended')) {
        relationship.parentNode?.removeChild(relationship)
      }
    })
    if (doc.documentElement.childNodes.length === 0) return undefined
  }
  return Buffer.from(new XMLSerializer().serializeToString(doc), 'utf8')
}

const replayPackageFingerprint = async (snapshot: DocSnapshot): Promise<string> => {
  if (snapshot.format !== 'docx') return createHash('sha256').update(snapshot.buffer).digest('hex')
  const hash = createHash('sha256')
  const names = Object.keys(snapshot.bundle.zip.files).filter(replayModelPart).sort()
  for (const name of names) {
    const entry = snapshot.bundle.zip.file(name)
    if (!entry) continue
    const normalized = normalizedReplayPart(name, await entry.async('nodebuffer'))
    if (!normalized) continue
    hash.update(name)
    hash.update('\0')
    hash.update(normalized)
    hash.update('\0')
  }
  return hash.digest('hex')
}

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

const getDetailedNodeCached = (snapshot: DocSnapshot, nodeId: string): DocxDetailedNode | null => {
  const cached = snapshot.detailByNodeId.get(nodeId)
  if (cached) return cached
  const internalId = resolveInternalNodeId(snapshot.identity, nodeId)
  const detail = getDetailedNode(snapshot.index, internalId)
  if (!detail) return null
  const publicDetail = toPublicDetailedNode(snapshot.identity, detail)
  snapshot.detailByNodeId.set(nodeId, publicDetail)
  return publicDetail
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

    if (request.action === 'segment_map') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'segment_map',
          segments: buildDocxSegmentMap(
            snapshot.index,
            snapshot.format === 'docx' ? snapshot.bundle : undefined
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
      const commentsXml = await snapshot.bundle.zip.file('word/comments.xml')?.async('text')
      const extendedXml = await snapshot.bundle.zip.file('word/commentsExtended.xml')?.async('text')
      const settingsXml = await snapshot.bundle.zip.file('word/settings.xml')?.async('text')
      const commentsDom = commentsXml
        ? new DOMParser().parseFromString(commentsXml, 'application/xml')
        : undefined
      const extendedDom = extendedXml
        ? new DOMParser().parseFromString(extendedXml, 'application/xml')
        : undefined
      const comments = commentsDom
        ? Array.from(commentsDom.getElementsByTagNameNS('*', 'comment')).map((comment) => {
            const paragraph = comment.getElementsByTagNameNS('*', 'p').item(0)
            return {
              commentId: localAttribute(comment, 'id'),
              text: Array.from(comment.getElementsByTagNameNS('*', 't'))
                .map((text) => text.textContent || '')
                .join(''),
              author: localAttribute(comment, 'author'),
              paragraphId: paragraph ? localAttribute(paragraph, 'paraId') : ''
            }
          })
        : []
      const commentIdByParagraphId = new Map(
        comments
          .filter((comment) => comment.paragraphId)
          .map((comment) => [comment.paragraphId, comment.commentId] as const)
      )
      const parentByParagraphId = new Map<string, string>()
      if (extendedDom) {
        Array.from(extendedDom.getElementsByTagNameNS('*', 'commentEx')).forEach((comment) => {
          const paragraphId = localAttribute(comment, 'paraId')
          const parentParagraphId = localAttribute(comment, 'paraIdParent')
          const parentCommentId = commentIdByParagraphId.get(parentParagraphId)
          if (paragraphId && parentCommentId) parentByParagraphId.set(paragraphId, parentCommentId)
        })
      }
      const revisionKindByName = {
        ins: 'insert',
        del: 'delete',
        moveFrom: 'move_from',
        moveTo: 'move_to'
      } as const
      const storyDocuments = [
        ...new Set([
          snapshot.bundle.documentDom,
          ...snapshot.bundle.stories.map((story) => story.dom)
        ])
      ]
      const revisions = (Object.keys(revisionKindByName) as Array<keyof typeof revisionKindByName>)
        .flatMap((name) =>
          storyDocuments.flatMap((document) =>
            Array.from(document.getElementsByTagNameNS('*', name)).map((node) => ({
              revisionId: localAttribute(node, 'id'),
              kind: revisionKindByName[name]
            }))
          )
        )
        .filter(
          (revision, index, all) =>
            revision.revisionId.length > 0 &&
            all.findIndex(
              (candidate) =>
                candidate.revisionId === revision.revisionId && candidate.kind === revision.kind
            ) === index
        )
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_annotations',
          trackChanges: Boolean(
            settingsXml &&
            new DOMParser()
              .parseFromString(settingsXml, 'application/xml')
              .getElementsByTagNameNS('*', 'trackRevisions').length > 0
          ),
          comments: comments.map((comment) => ({
            commentId: comment.commentId,
            text: comment.text,
            author: comment.author,
            ...(parentByParagraphId.get(comment.paragraphId)
              ? { parentCommentId: parentByParagraphId.get(comment.paragraphId) }
              : {})
          })),
          revisions
        }
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
      const internalId = resolveInternalNodeId(snapshot.identity, request.payload.nodeId)
      const entry =
        snapshot.index.nodesById.get(internalId) || snapshot.index.editableNodesById.get(internalId)
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
      if (!owner) {
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

    if (request.action === 'get_replay_snapshot_xml') {
      const snapshot = getSnapshot(request.runId, request.payload.docId)
      const serializer = new XMLSerializer()
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'get_replay_snapshot_xml',
          packageFingerprint: await replayPackageFingerprint(snapshot),
          nodes: [...snapshot.index.nodesById.entries()].map(([internalNodeId, node]) => {
            const nodeId = snapshot.identity.publicIdByInternalId.get(internalNodeId)
            if (!nodeId)
              throw new Error(`docx identity missing for internal node: ${internalNodeId}`)
            return { nodeId, rawXml: serializer.serializeToString(node.node) }
          })
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
      const invalidScopeNodeId = request.payload.scopeNodeIds.find(
        (nodeId) => !searchableNodeIds.has(nodeId)
      )
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
        scopeNodeIds: request.payload.scopeNodeIds,
        includeContext: request.payload.includeContext
      })
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'search',
          totalMatchCount: searchResult.totalMatchCount,
          matches: searchResult.matches
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
        const owner = snapshot.index.nodesById.get(visual.ownerNodeId)
        if (!owner) throw new Error(`visual owner node not found: ${request.payload.visualId}`)
        const visualsInNode = [...snapshot.index.visualsById.entries()].filter(([, candidate]) => {
          const candidateOwner = snapshot.index.nodesById.get(candidate.ownerNodeId)
          return candidateOwner?.nodeIndex === owner.nodeIndex
        })
        return {
          requestId: request.requestId,
          ok: true,
          payload: {
            action: 'get_visual',
            visualId: request.payload.visualId,
            kind: visual.kind,
            render: {
              nodeIndex: owner.nodeIndex,
              visualIndexInNode: visualsInNode.findIndex(([id]) => id === internalVisualId),
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
      const internalOperations = request.payload.operations.map((operation) =>
        toInternalOp(snapshot.identity, operation)
      )
      try {
        await validateDocxOperationTargets(snapshot.buffer, internalOperations)
      } catch (error) {
        return {
          requestId: request.requestId,
          ok: false,
          code: 'invalid_input',
          error: error instanceof Error ? error.message : String(error)
        }
      }
      const applied = await applyDocxOps({
        buffer: snapshot.buffer,
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
        previousSnapshot: snapshot,
        publicOps: request.payload.operations
      })
      runSession.set(newDocId, nextSnapshot)
      return {
        requestId: request.requestId,
        ok: true,
        payload: {
          action: 'apply_operations',
          newDocId,
          stats: toOpenStats(nextSnapshot.index),
          changedNodes: toPublicChangedNodes({
            changedNodes: applied.changedNodes,
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
