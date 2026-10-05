import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { applyDocxOps } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/opExecutor'
import {
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { collectVisualNodeEntries } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/types'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'

const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
  'base64'
)

describe('DOCX operation matrix', () => {
  it('executes the remaining content, format, table, media, comment, and revision operations', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-operation-matrix-'))
    const filePath = path.join(tempDir, 'matrix.docx')
    const imagePath = path.join(tempDir, 'image.png')
    try {
      await fs.writeFile(imagePath, pixel)
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'First' }] }]
          },
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'Second' }] }]
          },
          {
            type: 'table',
            children: ['A', 'B'].map((prefix) => ({
              type: 'table_row' as const,
              children: [`${prefix}1`, `${prefix}2`].map((text) => ({
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
            }))
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const index = buildDocumentNodeIndex(await loadDocxBundle(source))
      const paragraphs = index.outline.filter(
        (node) => node.type === 'paragraph' && node.story.type === 'body'
      )
      const table = index.outline.find((node) => node.type === 'table')!
      const tableDetail = index.detailByNodeId.get(table.nodeId)
      if (!tableDetail || tableDetail.type !== 'table') throw new Error('table detail missing')
      const rowId = tableDetail.children[0]!.nodeId
      const cellId = tableDetail.children[0]!.children[0]!.nodeId

      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            {
              type: 'move_node',
              nodeId: paragraphs[1]!.nodeId,
              anchorNodeId: paragraphs[0]!.nodeId,
              position: 'before'
            }
          ]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [{ type: 'reset_format', nodeId: paragraphs[0]!.nodeId }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [{ type: 'apply_named_style', nodeId: paragraphs[0]!.nodeId, styleId: 'Normal' }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [{ type: 'set_numbering', nodeId: paragraphs[0]!.nodeId, kind: 'bullet', level: 0 }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            { type: 'format_row', nodeId: rowId, format: { repeatHeader: true } },
            { type: 'format_cell', nodeId: cellId, format: { shading: 'FFFF00' } },
            { type: 'format_section', nodeId: paragraphs[0]!.nodeId, orientation: 'landscape' }
          ]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            {
              type: 'create_named_style',
              styleId: 'AuditStyle',
              name: 'Audit Style',
              run: { bold: true }
            },
            {
              type: 'update_named_style',
              styleId: 'AuditStyle',
              name: 'Updated Audit Style',
              paragraph: { keepWithNext: true }
            },
            { type: 'delete_named_style', styleId: 'AuditStyle' }
          ]
        })
      ).resolves.toBeDefined()

      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            {
              type: 'create_table',
              nodeId: paragraphs[0]!.nodeId,
              position: 'after',
              rows: [['new']]
            }
          ]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({ buffer: source, ops: [{ type: 'delete_table', tableNodeId: table.nodeId }] })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            { type: 'insert_column', tableNodeId: table.nodeId, columnIndex: 2, cells: ['x', 'y'] }
          ]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: source,
          ops: [{ type: 'split_cell', cellNodeId: cellId, rows: 2, columns: 2 }]
        })
      ).resolves.toBeDefined()

      const withImage = await applyDocxOps({
        buffer: source,
        ops: [{ type: 'insert_image', nodeId: paragraphs[0]!.nodeId, position: 'after', imagePath }]
      })
      const imageIndex = buildDocumentNodeIndex(await loadDocxBundle(withImage.buffer))
      const nodeId = collectVisualNodeEntries(imageIndex)[0]![0]
      await expect(
        applyDocxOps({
          buffer: withImage.buffer,
          ops: [{ type: 'replace_image', nodeId, imagePath }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: withImage.buffer,
          ops: [{ type: 'update_image', nodeId, widthCm: 2, altText: 'updated' }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({ buffer: withImage.buffer, ops: [{ type: 'delete_media', nodeId }] })
      ).resolves.toBeDefined()

      await expect(
        applyDocxOps({
          buffer: source,
          ops: [
            { type: 'add_comment', nodeId: paragraphs[0]!.nodeId, text: 'First', comment: 'one' },
            { type: 'update_comment', commentId: '0', comment: 'two' },
            { type: 'reply_comment', commentId: '0', comment: 'reply' },
            { type: 'delete_comment', commentId: '0' },
            { type: 'enable_track_changes' },
            { type: 'disable_track_changes' }
          ]
        })
      ).resolves.toBeDefined()

      const revisionZip = await JSZip.loadAsync(source)
      const documentXml = await revisionZip.file('word/document.xml')!.async('text')
      revisionZip.file(
        'word/document.xml',
        documentXml.replace(
          '<w:r><w:t>First</w:t></w:r>',
          '<w:ins w:id="42"><w:r><w:t>First</w:t></w:r></w:ins>'
        )
      )
      const revisionSource = await revisionZip.generateAsync({ type: 'nodebuffer' })
      await expect(
        applyDocxOps({
          buffer: revisionSource,
          ops: [{ type: 'accept_revision', revisionId: '42' }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({
          buffer: revisionSource,
          ops: [{ type: 'reject_revision', revisionId: '42' }]
        })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({ buffer: revisionSource, ops: [{ type: 'accept_all_revisions' }] })
      ).resolves.toBeDefined()
      await expect(
        applyDocxOps({ buffer: revisionSource, ops: [{ type: 'reject_all_revisions' }] })
      ).resolves.toBeDefined()
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
