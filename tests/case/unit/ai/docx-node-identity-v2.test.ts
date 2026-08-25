import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'

describe('DOCX v2 stable node identity', () => {
  it('preserves existing row and cell nodeIds after inserting a row', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-node-identity-v2-'))
    const filePath = path.join(tempDir, 'table.docx')
    const runId = randomUUID()
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'table',
            children: [
              {
                type: 'table_row',
                children: ['A1', 'A2'].map((text) => ({
                  type: 'table_cell' as const,
                  children: [
                    {
                      type: 'paragraph' as const,
                      children: [
                        { type: 'run' as const, children: [{ type: 'text' as const, text }] }
                      ]
                    }
                  ]
                }))
              },
              {
                type: 'table_row',
                children: ['B1', 'B2'].map((text) => ({
                  type: 'table_cell' as const,
                  children: [
                    {
                      type: 'paragraph' as const,
                      children: [
                        { type: 'run' as const, children: [{ type: 'text' as const, text }] }
                      ]
                    }
                  ]
                }))
              }
            ]
          }
        ]
      })
      const opened = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'open',
        payload: { sourcePath: filePath }
      })
      expect(opened.ok).toBe(true)
      if (!opened.ok || opened.payload.action !== 'open') return
      const outlined = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'outline',
        payload: {
          docId: opened.payload.docId,
          ranges: [{ fromNodeIndex: 0, toNodeIndex: 10 }],
          includeTables: true,
          includeCells: true
        }
      })
      expect(outlined.ok).toBe(true)
      if (!outlined.ok || outlined.payload.action !== 'outline') return
      const table = outlined.payload.nodes.find((node) => node.type === 'table')
      expect(table?.type).toBe('table')
      if (!table || table.type !== 'table') return
      const detailBefore = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'get_node',
        payload: { docId: opened.payload.docId, nodeId: table.nodeId }
      })
      expect(detailBefore.ok).toBe(true)
      if (!detailBefore.ok || detailBefore.payload.action !== 'get_node') return
      const beforeTable = detailBefore.payload.node
      expect(beforeTable.type).toBe('table')
      if (beforeTable.type !== 'table') return
      const originalRowIds = beforeTable.children.map((row) => row.nodeId)
      const originalCellIds = beforeTable.children.flatMap((row) =>
        row.children.map((cell) => cell.nodeId)
      )
      const inserted = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'apply_operation',
        payload: {
          docId: opened.payload.docId,
          operation: {
            type: 'insert_row',
            tableNodeId: table.nodeId,
            rowNodeId: originalRowIds[0],
            position: 'after',
            cells: ['N1', 'N2']
          }
        }
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok || inserted.payload.action !== 'apply_operation') return
      const detailAfter = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'get_node',
        payload: { docId: inserted.payload.newDocId, nodeId: table.nodeId }
      })
      expect(detailAfter.ok).toBe(true)
      if (!detailAfter.ok || detailAfter.payload.action !== 'get_node') return
      const afterTable = detailAfter.payload.node
      expect(afterTable.type).toBe('table')
      if (afterTable.type !== 'table') return
      expect(afterTable.children).toHaveLength(3)
      expect(afterTable.children[0]?.nodeId).toBe(originalRowIds[0])
      expect(afterTable.children[2]?.nodeId).toBe(originalRowIds[1])
      expect(afterTable.children[0]?.children.map((cell) => cell.nodeId)).toEqual(
        originalCellIds.slice(0, 2)
      )
      expect(afterTable.children[2]?.children.map((cell) => cell.nodeId)).toEqual(
        originalCellIds.slice(2)
      )
    } finally {
      await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'release_run',
        payload: {}
      })
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
