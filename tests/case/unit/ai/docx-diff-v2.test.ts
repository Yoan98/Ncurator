import { describe, expect, it } from 'vitest'
import {
  applyRevisionToReplaySession,
  createReplaySessionFromSnapshot,
  projectReplayNodes
} from '../../../../src/main/services/ai/human/tools/docx/review/replayTree'
import { normalizeReviewNodes } from '../../../../src/main/services/ai/human/tools/docx/review/reviewNormalizer'
import type {
  DocxReplaySession,
  DocxReplaySnapshot,
  DocxReplaySnapshotNode
} from '../../../../src/main/services/ai/human/tools/docx/types'

const paragraphNode = (nodeId: string, text: string): DocxReplaySnapshotNode => ({
  nodeId,
  nodeIndex: 0,
  kind: 'paragraph',
  story: { storyId: 'body', type: 'body' },
  rawXml: `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
  spec: { kind: 'paragraph', style: 'Normal', runs: [{ text }] },
  structureFingerprint: `paragraph:${text}`,
  visuals: [],
  tableCellNodeIds: []
})

const snapshot = (...nodes: DocxReplaySnapshotNode[]): DocxReplaySnapshot => ({
  packageFingerprint: nodes.map((node) => node.rawXml).join('|'),
  nodes: nodes.map((node, nodeIndex) => ({ ...node, nodeIndex })),
  nodeById: new Map(nodes.map((node) => [node.nodeId, node])),
  tableNodeIdByCellNodeId: new Map()
})

const sessionFrom = (source: DocxReplaySnapshot): DocxReplaySession =>
  createReplaySessionFromSnapshot({
    sourcePath: '/tmp/diff-v2.docx',
    sourceDocId: 'source',
    meta: {
      title: '',
      creator: '',
      lastModifiedBy: '',
      description: '',
      defaultFont: ''
    },
    stats: {
      nodeCount: source.nodes.length,
      bodyNodeCount: source.nodes.length,
      paragraphCount: source.nodes.length,
      tableCount: 0,
      imageCount: 0,
      visualCount: 0,
      visualKinds: [],
      charCount: source.nodes.reduce(
        (total, node) =>
          total + (node.spec.kind === 'paragraph' ? node.spec.runs[0]?.text.length || 0 : 0),
        0
      )
    },
    diskFingerprint: { checksum: 'source', byteSize: 1, modifiedAt: 1 },
    snapshot: source
  })

const normalized = (session: DocxReplaySession) =>
  normalizeReviewNodes(projectReplayNodes(session), session)

describe('DOCX v2 net diff', () => {
  it('collapses A to B to C into one A to C replacement', () => {
    const source = snapshot(paragraphNode('p1', 'A'))
    const session = sessionFrom(source)
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v2',
      op: { type: 'replace_text', nodeId: 'p1', oldText: 'A', newText: 'B' },
      createdNodes: [],
      nextSnapshot: snapshot(paragraphNode('p1', 'B'))
    })
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v3',
      op: { type: 'replace_text', nodeId: 'p1', oldText: 'B', newText: 'C' },
      createdNodes: [],
      nextSnapshot: snapshot(paragraphNode('p1', 'C'))
    })

    const result = normalized(session)
    expect(result.map((node) => node.reviewState)).toEqual(['replaced-old', 'replaced-new'])
    expect(
      result.map((node) => (node.spec.kind === 'paragraph' ? node.spec.runs[0]?.text : ''))
    ).toEqual(['A', 'C'])
  })

  it('removes the diff when A is restored', () => {
    const source = snapshot(paragraphNode('p1', 'A'))
    const session = sessionFrom(source)
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v2',
      op: { type: 'replace_text', nodeId: 'p1', oldText: 'A', newText: 'B' },
      createdNodes: [],
      nextSnapshot: snapshot(paragraphNode('p1', 'B'))
    })
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v3',
      op: { type: 'replace_text', nodeId: 'p1', oldText: 'B', newText: 'A' },
      createdNodes: [],
      nextSnapshot: source
    })

    expect(normalized(session).map((node) => node.reviewState)).toEqual(['normal'])
  })

  it('removes a node that was created and then deleted from the final diff', () => {
    const source = snapshot(paragraphNode('p1', 'A'))
    const session = sessionFrom(source)
    const inserted = snapshot(paragraphNode('p1', 'A'), paragraphNode('p2', 'temporary'))
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v2',
      op: {
        type: 'insert_nodes',
        nodeId: 'p1',
        position: 'after',
        nodes: [{ type: 'paragraph', text: 'temporary' }]
      },
      createdNodes: [{ nodeId: 'p2', type: 'paragraph' }],
      nextSnapshot: inserted
    })
    applyRevisionToReplaySession({
      session,
      revisionRef: 'v3',
      op: { type: 'delete_node', nodeId: 'p2' },
      createdNodes: [],
      nextSnapshot: source
    })

    expect(normalized(session).map((node) => node.reviewState)).toEqual(['normal'])
  })
})
