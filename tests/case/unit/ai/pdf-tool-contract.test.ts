import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { PDF_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/pdf/toolSpecs'
import {
  pdfOutlineSchema,
  pdfReadPagesSchema,
  pdfSearchSchema
} from '../../../../src/main/services/ai/human/tools/pdf/toolSchemas'

describe('ai unit PDF tool contract', () => {
  it('exposes outline, search and page reading', () => {
    expect(PDF_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'pdf_outline',
      'pdf_search',
      'pdf_read_pages'
    ])
    expect(SKILL_DEFINITIONS['pdf-read'].toolNames).toEqual(PDF_TOOL_SPECS.map((spec) => spec.name))
  })

  it('keeps selection and search limits in schemas', () => {
    expect(
      pdfReadPagesSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf',
        selection: { type: 'page_range', fromPage: 1, toPage: 9 }
      }).success
    ).toBe(true)
    expect(
      pdfSearchSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf',
        query: '过度拟合',
        mode: 'literal',
        pageRange: { fromPage: 1, toPage: 20 }
      }).success
    ).toBe(true)
    expect(
      pdfSearchSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf',
        query: '过度拟合',
        maxMatches: 51
      }).success
    ).toBe(false)
  })

  it('accepts outline input without echo fields in output schema', () => {
    expect(
      pdfOutlineSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf'
      }).success
    ).toBe(true)
  })
})
