import { describe, expect, it } from 'vitest'
import { docxEditSchema } from '../../../../src/main/services/ai/human/tools/docx/schemas'

describe('ai unit docx write schema contract', () => {
  it('accepts batch docx_edit actions', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'replace_text',
            blockIds: ['b:1'],
            query: '旧词',
            replace: '新词'
          },
          {
            type: 'insert_blocks',
            position: 'after',
            anchorBlockId: 'b:2',
            blocks: [
              {
                type: 'paragraph',
                children: [{ type: 'run', children: [{ type: 'text', text: '补充段落' }] }]
              }
            ]
          }
        ]
      }).success
    ).toBe(true)
  })

  it('rejects legacy top-level single-action docx_edit input', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'insert_after',
        anchorBlockId: 'b:1',
        blocks: [
          {
            type: 'paragraph',
            text: 'hello'
          }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects mixed locators inside a docx_edit action', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'update_table_cell',
            cellBlockId: 'tbl:1.r:1.c:1',
            anchorBlockId: 'b:1',
            text: 'Bob'
          }
        ]
      }).success
    ).toBe(false)
  })

  it.each(['red', '#FF0000', 'F00', 'GG0000', ''])('rejects invalid color %j', (color) => {
    const result = docxEditSchema.safeParse({
      sourcePath: 'a.docx',
      actions: [
        {
          type: 'style',
          target: { type: 'text_match', query: 'Heading', blockIds: ['b:1'] },
          patch: { kind: 'run', color }
        }
      ]
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ['actions', 0, 'patch', 'color'],
            message: expect.stringContaining('6 hexadecimal characters')
          })
        ])
      )
    }
  })

  it.each(['FF0000', 'ff0000'])('accepts six-digit hexadecimal color %s', (color) => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'style',
            target: { type: 'text_match', query: 'Heading', blockIds: ['b:1'] },
            patch: { kind: 'run', color }
          }
        ]
      }).success
    ).toBe(true)
  })

  it('rejects an empty style object', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'style',
            target: { type: 'text_match', query: 'Heading', blockIds: ['b:1'] },
            patch: { kind: 'run' }
          }
        ]
      }).success
    ).toBe(false)
  })

  it('rejects legacy simplified blocks and style_text', () => {
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [
          {
            type: 'insert_blocks',
            position: 'after',
            anchorBlockId: 'b:1',
            blocks: [{ type: 'paragraph', text: 'legacy' }]
          }
        ]
      }).success
    ).toBe(false)
    expect(
      docxEditSchema.safeParse({
        sourcePath: 'a.docx',
        actions: [{ type: 'style_text', blockId: 'b:1', query: 'x', style: { bold: true } }]
      }).success
    ).toBe(false)
  })
})
