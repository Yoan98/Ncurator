import { describe, expect, it } from 'vitest'
import { docxEditSchema } from '../../../../src/main/services/ai/human/tools/docx/schemas'

describe('ai unit docx write schema contract', () => {
  it('accepts flat docx_edit actions', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          { type: 'insert_blocks', blockId: 'b:1', position: 'after', blocks: [{ text: '补充段落' }] },
          { type: 'replace_text', blockIds: ['b:1'], query: '旧词', replace: '新词' }
        ]
      }).success
    ).toBe(true)
  })

  it('accepts a table as a flat string matrix', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [{ type: 'insert_blocks', blocks: [{ rows: [['列A', '列B'], ['1', '2']] }] }]
      }).success
    ).toBe(true)
  })

  it('accepts the five style actions', () => {
    const actions = [
      { type: 'style_text', query: '重点', style: { bold: true } },
      { type: 'style_paragraph', id: 'b:1', style: { alignment: 'center' } },
      { type: 'style_table', id: 't:1', style: { layout: 'fixed' } },
      { type: 'style_row', id: 'n:1', style: { repeatHeader: true } },
      { type: 'style_cell', id: 'c:1', style: { shading: 'FFFF00' } }
    ]
    for (const action of actions) {
      expect(docxEditSchema.safeParse({ sourcePath: 'a.docx', actions: [action] }).success).toBe(
        true
      )
    }
  })

  it('rejects legacy rich-tree content blocks', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'insert_blocks',
            blocks: [
              {
                type: 'paragraph',
                children: [{ type: 'run', children: [{ type: 'text', text: 'legacy' }] }]
              }
            ]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects legacy unified style action', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          { type: 'style', target: { type: 'block', blockId: 'b:1' }, patch: { kind: 'run', bold: true } }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects legacy top-level single-action input', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'insert_after',
        anchorBlockId: 'b:1',
        blocks: [{ text: 'hello' }]
      }).success
    ).toBe(false)
  })

  it.each(['red', '#FF0000', 'F00', 'GG0000', ''])('rejects invalid color %j', (color) => {
    const result = docxEditSchema.safeParse({
      sourcePath: 'a.docx',
      actions: [{ type: 'style_text', query: 'Heading', style: { color } }]
    })

    expect(result.success).toBe(false)
  })

  it('accepts a six-digit hexadecimal color', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [{ type: 'style_text', query: 'Heading', style: { color: 'FF0000' } }]
      }).success
    ).toBe(true)
  })

  it('rejects an empty style object', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [{ type: 'style_text', query: 'Heading', style: {} }]
      }).success
    ).toBe(false)
  })
})
