import { renderToolResultDataText } from '../../../../src/main/services/ai/human/shared/toolResultRenderers'
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

describe('tool result data fidelity', () => {
  it('renders PDF page text, search snippets and rendered image paths', () => {
    const readRendered = renderToolResultDataText({
      toolName: 'pdf_read_pages',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pageCount: 11,
        pages: [
          {
            pageNumber: 1,
            textStatus: 'available',
            charCount: 42,
            imageCount: 1,
            text: 'inputs parameters architecture predictions labels loss update'
          }
        ]
      }
    })
    const searchRendered = renderToolResultDataText({
      toolName: 'pdf_search',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pageCount: 11,
        query: '过度拟合',
        mode: 'literal',
        totalMatchCount: 1,
        returnedMatchCount: 1,
        matches: [{ pageNumber: 9, matchedText: '过度拟合', snippet: '右图属于过度拟合' }]
      }
    })
    const visualRendered = renderToolResultDataText({
      toolName: 'pdf_read_pages',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pages: [
          {
            pageNumber: 9,
            pageImagePath: '/runtime/page-9.png',
            text: '第9页右侧 Overfit 曲线显示验证表现变差。'
          }
        ]
      }
    })

    expect(readRendered).toContain('1')
    expect(readRendered).toContain('architecture')
    expect(searchRendered).toContain('9')
    expect(searchRendered).toContain('右图属于过度拟合')
    expect(visualRendered).toContain('9')
    expect(visualRendered).toContain('Overfit 曲线')
  })
})
