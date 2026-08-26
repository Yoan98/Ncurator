import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'

const fixturePath = path.resolve(
  'tests/fixtures/workspace/风险等级判断标准-图案设计【2026.2.10更新】.doc'
)

describe('docx legacy worker', () => {
  it('reads legacy doc through the common worker protocol and rejects writes', async () => {
    const runId = 'legacy-doc-worker-test'
    const opened = await handleDocxWorkerRequest({
      requestId: 'open',
      runId,
      action: 'open',
      payload: { sourcePath: fixturePath }
    })
    expect(opened.ok).toBe(true)
    if (!opened.ok || opened.payload.action !== 'open') return

    const outline = await handleDocxWorkerRequest({
      requestId: 'outline',
      runId,
      action: 'outline',
      payload: {
        docId: opened.payload.docId,
        fromNodeIndex: 0,
        toNodeIndex: 100,
        includeCells: true
      }
    })
    expect(outline.ok).toBe(true)
    if (!outline.ok || outline.payload.action !== 'outline') return
    expect(outline.payload.nodes.length).toBeGreaterThan(0)
    expect(outline.payload.nodes[0]?.text).toContain('风险等级的判断标准')

    const nodeId = outline.payload.nodes[0]!.nodeId
    const nodes = await handleDocxWorkerRequest({
      requestId: 'nodes',
      runId,
      action: 'get_nodes_by_ids',
      payload: {
        docId: opened.payload.docId,
        nodeIds: [nodeId]
      }
    })
    expect(nodes.ok).toBe(true)
    if (nodes.ok && nodes.payload.action === 'get_nodes_by_ids') {
      expect(nodes.payload.nodes[0]?.type).toBe('paragraph')
      expect(nodes.payload.nodes[0]?.text).toContain('风险等级的判断标准')
    }

    const search = await handleDocxWorkerRequest({
      requestId: 'search',
      runId,
      action: 'search',
      payload: {
        docId: opened.payload.docId,
        query: '区别率',
        mode: 'literal',
        scopeNodeIds: []
      }
    })
    expect(search.ok).toBe(true)
    if (search.ok && search.payload.action === 'search') {
      expect(search.payload.matches.length).toBeGreaterThan(0)
    }

    const write = await handleDocxWorkerRequest({
      requestId: 'write',
      runId,
      action: 'apply_operations',
      payload: {
        docId: opened.payload.docId,
        operations: [
          {
            type: 'replace_text',
            nodeId: outline.payload.nodes[0]!.nodeId,
            oldText: '风险等级的判断标准',
            newText: 'changed'
          }
        ]
      }
    })
    expect(write.ok).toBe(false)
    if (!write.ok) {
      expect(write.code).toBe('invalid_input')
      expect(write.error).toContain('legacy .doc')
    }
  })
})
