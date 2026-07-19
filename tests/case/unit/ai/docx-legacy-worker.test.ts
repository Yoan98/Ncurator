import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'

const fixturePath = path.resolve('tests/fixtures/legacy-doc/legacy-readable.doc')

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
        ranges: [{ fromBlockIndex: 0, toBlockIndex: 100 }],
        includeTables: true,
        includeCells: true
      }
    })
    expect(outline.ok).toBe(true)
    if (!outline.ok || outline.payload.action !== 'outline') return
    expect(outline.payload.blocks.length).toBeGreaterThan(0)
    expect(outline.payload.blocks[0]?.text).toContain('second test')

    const blockId = outline.payload.blocks[0]!.blockId
    const blocks = await handleDocxWorkerRequest({
      requestId: 'blocks',
      runId,
      action: 'get_blocks_by_ids',
      payload: {
        docId: opened.payload.docId,
        blockIds: [blockId]
      }
    })
    expect(blocks.ok).toBe(true)
    if (blocks.ok && blocks.payload.action === 'get_blocks_by_ids') {
      expect(blocks.payload.blocks[0]?.type).toBe('paragraph')
      expect(blocks.payload.blocks[0]?.text).toContain('Unicode characters')
    }

    const search = await handleDocxWorkerRequest({
      requestId: 'search',
      runId,
      action: 'search',
      payload: {
        docId: opened.payload.docId,
        query: 'Unicode characters',
        mode: 'literal',
        scopeBlockIds: []
      }
    })
    expect(search.ok).toBe(true)
    if (search.ok && search.payload.action === 'search') {
      expect(search.payload.matches.length).toBeGreaterThan(0)
    }

    const write = await handleDocxWorkerRequest({
      requestId: 'write',
      runId,
      action: 'apply_ops',
      payload: {
        docId: opened.payload.docId,
        ops: [{ type: 'replace_text', query: 'second test', replace: 'changed' }]
      }
    })
    expect(write.ok).toBe(false)
    if (!write.ok) {
      expect(write.code).toBe('invalid_input')
      expect(write.error).toContain('legacy .doc')
    }
  })
})
