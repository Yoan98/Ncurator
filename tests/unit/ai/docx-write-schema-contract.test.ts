import { describe, expect, it } from 'vitest'
import {
  docxEditSchema
} from '../../../src/main/services/ai/human/tools/docx/schemas'

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
                text: '补充段落'
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
})
