import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import { PDF_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/pdf/toolSpecs'
import {
  pdfReadPagesSchema,
  pdfReadVisualsSchema,
  pdfSearchSchema
} from '../../../../src/main/services/ai/human/tools/pdf/schemas'

describe('ai unit PDF tool contract', () => {
  it('exposes only inspect, search, page text reading and page visual reading', () => {
    expect(PDF_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'pdf_inspect',
      'pdf_search',
      'pdf_read_pages',
      'pdf_read_visuals'
    ])
    expect(SKILL_DEFINITIONS['pdf-read'].toolNames).toEqual(PDF_TOOL_SPECS.map((spec) => spec.name))
    expect(PDF_TOOL_SPECS.map((spec) => spec.name)).not.toContain('pdf_recognize_pages')
    expect(PDF_TOOL_SPECS.map((spec) => spec.name)).not.toContain('pdf_render_pages')
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
    expect(
      pdfReadVisualsSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf',
        requests: [{ index: 9, instruction: '识别页面中的图形结论' }]
      }).success
    ).toBe(true)
    expect(
      pdfReadVisualsSchema.safeParse({
        sourcePath: '学习笔记/深度学习.pdf',
        requests: Array.from({ length: 11 }, (_, index) => ({
          index: index + 1,
          instruction: '识别页面中的图形结论'
        }))
      }).success
    ).toBe(false)
  })
})
