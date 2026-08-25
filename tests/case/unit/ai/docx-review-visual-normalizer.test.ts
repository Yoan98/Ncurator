import { describe, expect, it } from 'vitest'
import { normalizeReviewNodes } from '../../../../src/main/services/ai/human/tools/docx/review/reviewNormalizer'
import { createReplaySessionFromSnapshot } from '../../../../src/main/services/ai/human/tools/docx/review/replayTree'
import type {
  DocxReplaySession,
  DocxReplaySnapshot
} from '../../../../src/main/services/ai/human/tools/docx/types'

const paragraphSpec = {
  kind: 'paragraph' as const,
  style: 'Normal',
  runs: [{ text: '' }]
}

const makeSnapshot = (input: {
  kind?: 'paragraph' | 'table'
  spec?: DocxReplaySnapshot['nodes'][number]['spec']
  structureFingerprint: string
  visualIds: string[]
}): DocxReplaySnapshot => {
  const node = {
    nodeId: 'node-1',
    nodeIndex: 0,
    kind: input.kind || 'paragraph',
    rawXml: '<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
    spec: input.spec || paragraphSpec,
    structureFingerprint: input.structureFingerprint,
    visuals: input.visualIds.map((visualId) => ({ visualId, kind: 'image' as const })),
    tableCellNodeIds: []
  }
  return {
    nodes: [node],
    nodeById: new Map([[node.nodeId, node]]),
    tableNodeIdByCellNodeId: new Map()
  }
}

const makeSession = (snapshot: DocxReplaySnapshot): DocxReplaySession =>
  createReplaySessionFromSnapshot({
    sourcePath: '/tmp/source.docx',
    sourceDocId: 'doc-1',
    meta: { title: 'source', author: '', subject: '', keywords: '', created: '', modified: '' },
    stats: {
      paragraphCount: 1,
      tableCount: 0,
      imageCount: snapshot.nodes[0]?.visuals.length || 0,
      visualCount: snapshot.nodes[0]?.visuals.length || 0,
      visualKinds: snapshot.nodes[0]?.visuals.length ? ['image'] : [],
      nodeCount: 1
    },
    diskFingerprint: { checksum: 'checksum', byteSize: 1, modifiedAt: 1 },
    snapshot
  })

describe('docx review visual normalization', () => {
  it('does not normalize an image paragraph replaced by an empty paragraph as unchanged', () => {
    const source = makeSnapshot({
      structureFingerprint: 'paragraph-with-image',
      visualIds: ['visual-1']
    })
    const session = makeSession(source)
    const node = session.nodeById.get(session.rootNodeIds[0])!
    node.structureFingerprint = 'empty-paragraph'
    node.visualIds = []

    const result = normalizeReviewNodes([node], session)

    expect(result.map((item) => item.reviewState)).toEqual(['replaced-old', 'replaced-new'])
    expect(result[0]?.visualIds).toEqual(['visual-1'])
    expect(result[1]?.visualIds).toEqual([])
  })

  it('does not reduce a table visual deletion to a text-only formatted cell change', () => {
    const tableSpec = {
      kind: 'table' as const,
      rows: [[{ paragraphs: [paragraphSpec] }]]
    }
    const source = makeSnapshot({
      kind: 'table',
      spec: tableSpec,
      structureFingerprint: 'table-with-image',
      visualIds: ['visual-1']
    })
    const session = makeSession(source)
    const node = session.nodeById.get(session.rootNodeIds[0])!
    node.structureFingerprint = 'table-without-image'
    node.visualIds = []

    const result = normalizeReviewNodes([node], session)

    expect(result.map((item) => item.reviewState)).toEqual(['replaced-old', 'replaced-new'])
    expect(result.every((item) => item.tableCellChanges === undefined)).toBe(true)
  })
})
