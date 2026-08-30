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
        'read_image',
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
        'llm_recognize'
      ])
    )
  })

  it('describes image reading as a main-model multimodal input', () => {
    const spec = getToolSpec('read_image')
    const description = spec?.promptSpec.description || ''

    expect(description).toContain('图片')
    expect(description).toContain('1 至 10')
    expect(description).not.toMatch(/先|然后|再调用|步骤|流程/)
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
    expect(spec?.promptSpec.description).toBe('将 SVG 内容渲染为图片并保存到工作区。')
  })

  it('requires a dedicated model result renderer for every tool', () => {
    ALL_TOOL_SPECS.forEach((spec) => {
      expect(typeof spec.modelResult.renderSuccess).toBe('function')
    })
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

  it('keeps capability prompts free of cross-tool orchestration hints', () => {
    const tools = [
      'pdf_outline',
      'pdf_search',
      'pdf_read_pages',
      'ppt_read_outline',
      'ppt_read_slides',
      'ppt_search',
      'docx_read_outline',
      'docx_search',
      'docx_read_nodes',
      'text_file_read',
      'text_file_search',
      'text_file_edit',
      'web_search',
      'browser_use',
      'kb_search',
      'kb_list_documents',
      'terminal_run',
      'terminal_read',
      'image_generate',
      'learn_skill',
      'update_plan',
      'read_image'
    ] as const

    tools.forEach((toolName) => {
      const spec = getToolSpec(toolName)
      const description = spec?.promptSpec.description || ''
      expect(description).not.toMatch(/read_image|交给|先|然后|再调用|步骤|流程/u)
      expect(description.length).toBeGreaterThan(0)
      expect(description.length).toBeLessThan(120)
    })
  })

  it('keeps the PPT edit prompt as a capability boundary', () => {
    const spec = getToolSpec('ppt_edit')
    const description = spec?.promptSpec.description || ''

    expect(description).toBe('创建或编辑 PPTX 的页面、元素、文字和备注。')
    expect(description).not.toContain('insert_slide')
    expect(description).not.toContain('HTML')
    expect(description).not.toContain('\n\n')
  })
})
