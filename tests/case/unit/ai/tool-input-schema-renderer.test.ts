import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { ALL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/registry'
import { renderToolInputSchemaForPrompt } from '../../../../src/main/services/ai/human/tools/schemaPromptRenderer'

describe('ai unit tool input schema renderer', () => {
  it('renders every registered Human tool without anonymous definitions', () => {
    const lengths = Object.fromEntries(
      ALL_TOOL_SPECS.map((spec) => {
        const rendered = renderToolInputSchemaForPrompt(spec.inputSchema, { compact: true })
        expect(rendered).not.toMatch(/__schema\d+/)
        expect(rendered.length).toBeGreaterThan(2)
        expect(rendered.length).toBeLessThan(50_000)
        return [spec.name, rendered.length]
      })
    )

    expect(lengths).toMatchSnapshot()
  })

  it('keeps string, numeric, array and object constraints', () => {
    const rendered = renderToolInputSchemaForPrompt(
      z
        .object({
          name: z
            .string()
            .min(2)
            .max(8)
            .regex(/^[a-z]+$/),
          count: z.number().min(1).max(9).multipleOf(2),
          values: z.array(z.string()).min(1).max(3),
          code: z
            .string()
            .refine((value) => value !== 'reserved')
            .meta({ 'x-constraint': 'code cannot be reserved' })
        })
        .strict(),
      { compact: true }
    )

    expect(rendered).toContain('minLength=2')
    expect(rendered).toContain('maxLength=8')
    expect(rendered).toContain('pattern="^[a-z]+$"')
    expect(rendered).toContain('minimum=1')
    expect(rendered).toContain('maximum=9')
    expect(rendered).toContain('multipleOf=2')
    expect(rendered).toContain('minItems=1')
    expect(rendered).toContain('maxItems=3')
    expect(rendered).toContain('constraint="code cannot be reserved"')
  })

  it('renders DOCX shared definitions once and keeps real request limits', () => {
    const docxEdit = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_edit')!
    const docxVisuals = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_read_visuals')!
    const editRendered = renderToolInputSchemaForPrompt(docxEdit.inputSchema, { compact: true })
    const visualsRendered = renderToolInputSchemaForPrompt(docxVisuals.inputSchema, {
      compact: true
    })

    for (const definition of [
      'DocxRunStyle',
      'DocxCreateRun',
      'DocxCreateParagraph',
      'DocxCreateTable',
      'DocxCreateBlock'
    ]) {
      expect(editRendered.match(new RegExp(`${definition} =`, 'g'))).toHaveLength(1)
    }
    expect(visualsRendered).toContain('minItems=1')
    expect(visualsRendered).toContain('maxItems=10')
    expect(editRendered).toContain('hyperlink requires target or anchor')
    expect(editRendered).toContain('style patch must contain at least one property')
  })
})
