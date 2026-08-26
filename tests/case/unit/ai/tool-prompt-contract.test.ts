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
        'docx_read_visuals',
        'ppt_read_outline',
        'ppt_read_visuals',
        'pdf_read_visuals',
        'image_analyze',
        'image_generate'
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

  it('describes docx visual reading without teaching a tool sequence', () => {
    const description = getToolSpec('docx_read_visuals')?.promptSpec.description || ''

    expect(description).toContain('visualId')
    expect(description).toContain('1 至 10')
    expect(description).not.toMatch(/先|然后|再调用|步骤|流程/)
    expect(description).not.toContain('docx_read_blocks')
    expect(description).not.toContain('image_analyze')
  })

  it('keeps image_generate minimal and informational', () => {
    const spec = getToolSpec('image_generate')
    const parsed = spec?.inputSchema.safeParse({
      outputPath: 'images/result.png',
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />'
    })

    expect(parsed?.success).toBe(true)
    expect(
      spec?.inputSchema.safeParse({
        outputPath: 'images/result.png',
        svg: '<svg />',
        format: 'png'
      }).success
    ).toBe(false)
    expect(spec?.promptSpec.description).toBe(
      '将 SVG 内容渲染为图片并保存到用户工作区域。输出格式由 outputPath 的文件扩展名决定，支持 .png、.jpg、.jpeg 和 .webp；返回生成文件路径或错误。'
    )
  })

  it('rejects structured document paths from text file tools', () => {
    const readSpec = getToolSpec('text_file_read')
    const editSpec = getToolSpec('text_file_edit')

    expect(readSpec?.inputSchema.safeParse({ type: 'lines', sourcePath: 'report.docx' }).success).toBe(
      false
    )
    expect(
      editSpec?.inputSchema.safeParse({
        sourcePath: 'slides.pptx',
        action: 'create',
        content: 'not a presentation'
      }).success
    ).toBe(false)
    expect(
      readSpec?.inputSchema.safeParse({ type: 'lines', sourcePath: 'notes.md' }).success
    ).toBe(true)
  })

  it('keeps the PPT page creation rules compact and explicitly scoped', () => {
    const spec = getToolSpec('ppt_edit')
    const description = spec?.promptSpec.description || ''

    expect(description).toContain('PPT 建立新页面时 HTML 的设计规则：')
    expect(description).not.toContain('\n\n')
  })
})
