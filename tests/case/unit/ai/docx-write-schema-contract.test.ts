import { describe, expect, it } from 'vitest'
import {
  docxCommentsRevisionsSchema,
  docxContentEditSchema,
  docxFormatSchema,
  docxMediaEditSchema,
  docxTableEditSchema
} from '../../../../src/main/services/ai/human/tools/docx/schemas'

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
        nodes: [{ type: 'paragraph', text: '补充段落', styleId: 'Normal' }]
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

  it('rejects empty format patches and invalid colors', () => {
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
    ).toBe(false)
  })

  it('covers table, media, comment, and revision operations', () => {
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
      docxMediaEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'update_image',
        visualId: 'visual_1',
        widthCm: 5
      }).success
    ).toBe(true)
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
      docxMediaEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'insert_image',
        nodeId: 'node_1',
        position: 'document_end',
        imagePath: '/tmp/a.png'
      }).success
    ).toBe(false)
    expect(
      docxMediaEditSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'update_image',
        visualId: 'visual_1'
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
