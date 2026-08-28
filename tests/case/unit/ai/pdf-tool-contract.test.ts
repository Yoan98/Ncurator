import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { PDF_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/pdf/toolSpecs'
import {
  pdfReadPagesSchema,
  pdfSearchSchema
} from '../../../../src/main/services/ai/human/tools/pdf/schemas'

describe('ai unit PDF tool contract', () => {
  it('exposes inspect, search and page reading', () => {
    expect(PDF_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'pdf_inspect',
      'pdf_search',
      'pdf_read_pages'
    ])
    expect(SKILL_DEFINITIONS['pdf-read'].toolNames).toEqual(PDF_TOOL_SPECS.map((spec) => spec.name))
  })

  it('keeps selection, search and visual reading limits in schemas', () => {
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
        maxMatches: 51
      }).success
    ).toBe(false)
  })
})
