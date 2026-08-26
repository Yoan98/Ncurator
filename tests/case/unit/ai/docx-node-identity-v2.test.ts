import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'
import JSZip from 'jszip'

describe('DOCX v2 stable node identity', () => {
  it('keeps header identity when document_end adds a body node', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-story-identity-v2-'))
    const filePath = path.join(tempDir, 'story.docx')
    const runId = randomUUID()
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'Body' }] }]
          }
        ]
      })
      const zip = await JSZip.loadAsync(await fs.readFile(filePath))
      const relationshipsPath = 'word/_rels/document.xml.rels'
      const relationships = await zip.file(relationshipsPath)!.async('text')
      zip.file(
        relationshipsPath,
        relationships.replace(
          '</Relationships>',
          '<Relationship Id="rIdHeaderStable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'
        )
      )
      zip.file(
        'word/header1.xml',
        '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header stable</w:t></w:r></w:p></w:hdr>'
      )
      await fs.writeFile(filePath, await zip.generateAsync({ type: 'nodebuffer' }))
      const opened = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'open',
        payload: { sourcePath: filePath }
      })
      expect(opened.ok).toBe(true)
      if (!opened.ok || opened.payload.action !== 'open') return
      const before = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'outline',
        payload: {
          docId: opened.payload.docId,
          fromNodeIndex: 0,
          toNodeIndex: 10,
          includeCells: true
        }
      })
      expect(before.ok).toBe(true)
      if (!before.ok || before.payload.action !== 'outline') return
      const header = before.payload.nodes.find((node) => node.story.type === 'header')!
      const edited = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'apply_operations',
        payload: {
          docId: opened.payload.docId,
          operations: [
            {
              type: 'insert_nodes',
              position: 'document_end',
              nodes: [{ type: 'paragraph', text: 'Body end' }]
            }
          ]
        }
      })
      expect(edited.ok).toBe(true)
      if (!edited.ok || edited.payload.action !== 'apply_operations') return
      const after = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'outline',
        payload: {
          docId: edited.payload.newDocId,
          fromNodeIndex: 0,
          toNodeIndex: 10,
          includeCells: true
        }
      })
      expect(after.ok).toBe(true)
      if (!after.ok || after.payload.action !== 'outline') return
      expect(after.payload.nodes.find((node) => node.story.type === 'header')?.nodeId).toBe(
        header.nodeId
      )
      expect(
        after.payload.nodes.filter((node) => node.story.type === 'body').map((node) => node.text)
      ).toEqual(['Body', 'Body end'])
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

  it('keeps anchor identity and assigns new ids for before and after insertions', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-anchor-identity-v2-'))
    const filePath = path.join(tempDir, 'anchors.docx')
    const runId = randomUUID()
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'Anchor' }] }]
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
          fromNodeIndex: 0,
          toNodeIndex: 2,
          includeCells: true
        }
      })
      expect(outlined.ok).toBe(true)
      if (!outlined.ok || outlined.payload.action !== 'outline') return
      const anchorId = outlined.payload.nodes[0]!.nodeId
      const insertedBefore = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'apply_operations',
        payload: {
          docId: opened.payload.docId,
          operations: [
            {
              type: 'insert_nodes',
              nodeId: anchorId,
              position: 'before',
              nodes: [
                { type: 'paragraph', text: 'Before one' },
                { type: 'paragraph', text: 'Before two' }
              ]
            }
          ]
        }
      })
      expect(insertedBefore.ok).toBe(true)
      if (!insertedBefore.ok || insertedBefore.payload.action !== 'apply_operations') return
      const insertedAfter = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'apply_operations',
        payload: {
          docId: insertedBefore.payload.newDocId,
          operations: [
            {
              type: 'insert_nodes',
              nodeId: anchorId,
              position: 'after',
              nodes: [{ type: 'paragraph', text: 'After' }]
            }
          ]
        }
      })
      expect(insertedAfter.ok).toBe(true)
      if (!insertedAfter.ok || insertedAfter.payload.action !== 'apply_operations') return
      const after = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'outline',
        payload: {
          docId: insertedAfter.payload.newDocId,
          fromNodeIndex: 0,
          toNodeIndex: 3,
          includeCells: true
        }
      })
      expect(after.ok).toBe(true)
      if (!after.ok || after.payload.action !== 'outline') return
      expect(after.payload.nodes.map((node) => node.text)).toEqual([
        'Before one',
        'Before two',
        'Anchor',
        'After'
      ])
      expect(after.payload.nodes[2]?.nodeId).toBe(anchorId)
      expect(new Set(after.payload.nodes.map((node) => node.nodeId)).size).toBe(4)
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

  it('does not give an existing identical run id to a new inside_start run', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-run-identity-v2-'))
    const filePath = path.join(tempDir, 'runs.docx')
    const runId = randomUUID()
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'same' }] }]
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
          fromNodeIndex: 0,
          toNodeIndex: 2,
          includeCells: true
        }
      })
      if (!outlined.ok || outlined.payload.action !== 'outline') return
      const paragraphId = outlined.payload.nodes[0]!.nodeId
      const before = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'get_node',
        payload: { docId: opened.payload.docId, nodeId: paragraphId }
      })
      if (
        !before.ok ||
        before.payload.action !== 'get_node' ||
        before.payload.node.type !== 'paragraph'
      )
        return
      const oldRunId = before.payload.node.children[0]!.nodeId
      const edited = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'apply_operations',
        payload: {
          docId: opened.payload.docId,
          operations: [
            {
              type: 'insert_nodes',
              nodeId: paragraphId,
              position: 'inside_start',
              nodes: [{ type: 'run', text: 'same' }]
            }
          ]
        }
      })
      expect(edited.ok).toBe(true)
      if (!edited.ok || edited.payload.action !== 'apply_operations') return
      const after = await handleDocxWorkerRequest({
        requestId: randomUUID(),
        runId,
        action: 'get_node',
        payload: { docId: edited.payload.newDocId, nodeId: paragraphId }
      })
      if (
        !after.ok ||
        after.payload.action !== 'get_node' ||
        after.payload.node.type !== 'paragraph'
      )
        return
      expect(after.payload.node.children).toHaveLength(2)
      expect(after.payload.node.children[0]!.nodeId).not.toBe(oldRunId)
      expect(after.payload.node.children[1]!.nodeId).toBe(oldRunId)
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
          fromNodeIndex: 0,
          toNodeIndex: 10,
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
        action: 'apply_operations',
        payload: {
          docId: opened.payload.docId,
          operations: [
            {
              type: 'insert_row',
              tableNodeId: table.nodeId,
              rowNodeId: originalRowIds[0],
              position: 'after',
              cells: ['N1', 'N2']
            }
          ]
        }
      })
      expect(inserted.ok).toBe(true)
      if (!inserted.ok || inserted.payload.action !== 'apply_operations') return
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
