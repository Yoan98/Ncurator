import { describe, expect, it } from 'vitest'
import {
  ALL_TOOL_SPECS,
  getToolSpec,
  listAllToolNames
} from '../../../../src/main/services/ai/human/tools/registry'

describe('ai unit tool prompt contract', () => {
  it('keeps tool prompts free of legacy usage-teaching fields', () => {
    ALL_TOOL_SPECS.forEach((spec) => {
      expect(spec.promptSpec).toEqual({
        name: spec.name,
        description: expect.any(String)
      })
    })
  })

  it('uses the new unambiguous tool names without compatibility aliases', () => {
    const names = listAllToolNames()

    expect(names).toEqual(
      expect.arrayContaining([
        'text_file_read',
        'text_file_edit',
        'docx_read_outline',
        'ppt_read_outline',
        'ppt_read_visuals',
        'pdf_read_visuals',
        'image_analyze'
      ])
    )
    expect(names).not.toEqual(
      expect.arrayContaining([
        'file_read',
        'file_edit',
        'docx_outline',
        'ppt_outline',
        'ppt_render',
        'ppt_render_slides',
        'pdf_render_pages',
        'llm_recognize'
      ])
    )
  })

  it('rejects structured document paths from text file tools', () => {
    const readSpec = getToolSpec('text_file_read')
    const editSpec = getToolSpec('text_file_edit')

    expect(readSpec?.inputSchema.safeParse({ sourcePath: 'report.docx' }).success).toBe(false)
    expect(
      editSpec?.inputSchema.safeParse({
        sourcePath: 'slides.pptx',
        action: 'create',
        content: 'not a presentation'
      }).success
    ).toBe(false)
    expect(readSpec?.inputSchema.safeParse({ sourcePath: 'notes.md' }).success).toBe(true)
  })

  it('keeps the PPT page creation rules compact and explicitly scoped', () => {
    const spec = getToolSpec('ppt_edit')
    const description = spec?.promptSpec.description || ''

    expect(description).toContain('PPT 建立新页面时 HTML 的设计规则：')
    expect(description).not.toContain('\n\n')
  })
})
