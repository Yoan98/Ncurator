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
        nodeId: 'node_1',
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
        nodeId: 'node_1',
        text: '标题',
        format: {}
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: 'a.docx',
        type: 'format_text',
        nodeId: 'node_1',
        text: '标题',
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
        fromRow: 0,
        fromColumn: 0,
        toRow: 1,
        toColumn: 1
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
})
