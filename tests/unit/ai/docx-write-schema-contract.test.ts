import { describe, expect, it } from 'vitest'
import {
  docxHeadingEditSchema,
  docxParagraphEditSchema,
  docxTableEditSchema
} from '../../../src/main/services/ai/human/tools/docx/schemas'

describe('ai unit docx write schema contract', () => {
  it('rejects mixed locators for paragraph edit actions', () => {
    expect(
      docxParagraphEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'insert_after',
        anchorBlockId: 'b:1',
        blockId: 'b:2',
        text: 'hello'
      }).success
    ).toBe(false)

    expect(
      docxParagraphEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'delete',
        blockId: 'b:1',
        anchorBlockId: 'b:2'
      }).success
    ).toBe(false)
  })

  it('rejects mixed locators for heading edit actions', () => {
    expect(
      docxHeadingEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'insert_before',
        anchorBlockId: 'b:1',
        blockId: 'b:2',
        level: 2,
        text: 'Title'
      }).success
    ).toBe(false)

    expect(
      docxHeadingEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'replace_text',
        blockId: 'b:1',
        anchorBlockId: 'b:2',
        level: 2,
        text: 'Title'
      }).success
    ).toBe(false)
  })

  it('rejects mixed locators for table edit actions', () => {
    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'insert_after',
        anchorBlockId: 'b:1',
        cellBlockId: 'tbl:1.r:1.c:1',
        rows: [['A']]
      }).success
    ).toBe(false)

    expect(
      docxTableEditSchema.safeParse({
        sourcePath: 'a.docx',
        action: 'update_cell',
        cellBlockId: 'tbl:1.r:1.c:1',
        anchorBlockId: 'b:1',
        text: 'Bob'
      }).success
    ).toBe(false)
  })
})
