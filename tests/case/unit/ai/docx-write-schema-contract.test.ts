import { describe, expect, it } from 'vitest'
import {
  docxCommentsRevisionsSchema,
  docxContentEditSchema,
  docxFormatSchema,
  docxTableEditSchema
} from '../../../../src/main/services/ai/human/tools/docx/schemas'
import { compileDocxOperations } from '../../../../src/main/services/ai/human/tools/docx/tools/writeToolRuntime'
import { normalizeDocxHexColor } from '../../../../src/main/services/ai/human/tools/docx/utils/color'
import { createParagraphFromNode } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/createNodeDom'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'

describe('ai unit docx write schema contract', () => {
  it('accepts one content operation without an actions array', () => {
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'replace_text',
        nodeId: 'node_1',
        oldText: '旧词',
        newText: '新词'
      }).success
    ).toBe(true)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [{ type: 'replace_text' }]
      }).success
    ).toBe(false)
  })

  it('supports shallow node insertion and enforces position anchors', () => {
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_nodes',
        position: 'inside_end',
        nodeId: 'node_container',
        nodes: [{ type: 'paragraph', text: '补充段落', style: { styleId: 'Normal' } }]
      }).success
    ).toBe(true)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_nodes',
        position: 'inside_end',
        nodeId: 'node_container',
        nodes: [
          {
            type: 'paragraph',
            text: '强调段落',
            style: { alignment: 'center' },
            runStyle: { bold: true, color: 'FF0000' }
          }
        ]
      }).success
    ).toBe(true)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_nodes',
        position: 'document_end',
        nodeId: 'node_invalid',
        nodes: [{ type: 'paragraph', text: '尾部' }]
      }).success
    ).toBe(false)
  })

  it('allows replace_text to carry run style and rejects empty format patches', () => {
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'replace_text',
        nodeId: 'node_1',
        oldText: '旧词',
        newText: '新词',
        format: { bold: true, color: 'FF0000' }
      }).success
    ).toBe(true)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'replace_text',
        nodeId: 'node_1',
        oldText: '旧词',
        newText: '新词',
        format: {}
      }).success
    ).toBe(false)
    expect(
      compileDocxOperations({
        sourcePath: 'a.docx',
        type: 'replace_text',
        nodeId: 'node_1',
        oldText: '旧词',
        newText: '新词',
        format: { bold: true }
      })
    ).toEqual([
      {
        type: 'replace_text',
        nodeId: 'node_1',
        oldText: '旧词',
        newText: '新词'
      },
      {
        type: 'format_text',
        nodeId: 'node_1',
        text: '新词',
        format: { bold: true }
      }
    ])
  })

  it('supports local and named style operations', () => {
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_paragraph',
        nodeIds: ['node_1', 'node_2'],
        format: { alignment: 'center' }
      }).success
    ).toBe(true)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'update_named_style',
        styleId: 'Heading1',
        run: { color: 'FF0000' }
      }).success
    ).toBe(true)
  })

  it('rejects empty format patches and accepts optional # on colors', () => {
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_text',
        targets: [{ nodeId: 'node_1', text: '标题' }],
        format: {}
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_text',
        targets: [{ nodeId: 'node_1', text: '标题' }],
        format: { color: '#FF0000' }
      }).success
    ).toBe(true)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_text',
        targets: [{ nodeId: 'node_1', text: '标题' }],
        format: { color: 'red' }
      }).success
    ).toBe(false)
    expect(normalizeDocxHexColor('#ff0000')).toBe('FF0000')
    expect(normalizeDocxHexColor('aabbcc')).toBe('AABBCC')
  })

  it('strips leading # when writing run colors into OOXML', () => {
    const doc = new DOMParser().parseFromString(
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>',
      'application/xml'
    )
    const paragraph = createParagraphFromNode(
      doc,
      {
        type: 'paragraph',
        children: [
          {
            type: 'run',
            style: { color: '#a1b2c3', highlight: '#ffee00' },
            children: [{ type: 'text', text: '色' }]
          }
        ]
      },
      { addHyperlink: () => 'rId1', persist: async () => undefined }
    )
    const xml = new XMLSerializer().serializeToString(paragraph)
    expect(xml).toContain('w:val="A1B2C3"')
    expect(xml).toContain('w:fill="FFEE00"')
    expect(xml).not.toContain('#')
  })

  it('covers table, media, comment, and revision operations', () => {
    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_table',
        nodeIds: ['node_table'],
        format: { alignment: 'center' }
      }).success
    ).toBe(true)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_table',
        nodeIds: ['node_table'],
        format: { alignment: 'center' }
      }).success
    ).toBe(false)
    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'merge_cells',
        tableNodeId: 'node_table',
        fromRow: 1,
        fromColumn: 1,
        toRow: 2,
        toColumn: 2
      }).success
    ).toBe(true)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'replace_node',
        nodeId: 'visual_1',
        node: { type: 'visual', widthCm: 5 }
      }).success
    ).toBe(true)
    expect(
      compileDocxOperations({
        sourcePath: 'a.docx',
        type: 'replace_node',
        nodeId: 'visual_1',
        node: { type: 'visual', widthCm: 5, altText: 'updated' }
      })
    ).toEqual([
      {
        type: 'replace_node',
        nodeId: 'visual_1',
        node: { type: 'visual', widthCm: 5, altText: 'updated' }
      }
    ])
    expect(
      compileDocxOperations({
        sourcePath: 'a.docx',
        type: 'replace_node',
        nodeId: 'visual_1',
        node: { type: 'visual', imagePath: '/tmp/new.png', heightCm: 4 }
      })
    ).toEqual([
      {
        type: 'replace_node',
        nodeId: 'visual_1',
        node: { type: 'visual', imagePath: '/tmp/new.png', heightCm: 4 }
      }
    ])
    expect(
      docxCommentsRevisionsSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'reply_comment',
        commentId: '1',
        comment: '同意'
      }).success
    ).toBe(true)
    expect(
      docxCommentsRevisionsSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'accept_revision',
        revisionId: '7'
      }).success
    ).toBe(true)
  })

  it('rejects ambiguous anchors, zero-based table coordinates, and empty updates', () => {
    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'create_table',
        position: 'before',
        rows: [['x']]
      }).success
    ).toBe(false)
    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'delete_column',
        tableNodeId: 'node_table',
        columnIndex: 0
      }).success
    ).toBe(false)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_nodes',
        nodeId: 'node_1',
        position: 'document_end',
        nodes: [{ type: 'visual', imagePath: '/tmp/a.png' }]
      }).success
    ).toBe(false)
    expect(
      docxContentEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_nodes',
        position: 'document_end',
        nodes: [{ type: 'visual' }]
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'update_named_style',
        styleId: 'Heading1'
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_section',
        nodeId: 'node_1'
      }).success
    ).toBe(false)
  })
})
