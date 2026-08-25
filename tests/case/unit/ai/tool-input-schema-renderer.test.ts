import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { ALL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/registry'
import {
  docxReadBlocksOutputSchema,
  docxOutlineOutputSchema,
  docxSearchOutputSchema,
  docxWriteOutputSchema
} from '../../../../src/main/services/ai/human/tools/docx/outputSchemas'
import {
  pdfInspectOutputSchema,
  pdfReadPagesOutputSchema,
  pdfSearchOutputSchema
} from '../../../../src/main/services/ai/human/tools/pdf/outputSchemas'
import {
  pptEditOutputSchema,
  pptReadOutlineOutputSchema,
  pptReadSlidesOutputSchema,
  pptSearchOutputSchema
} from '../../../../src/main/services/ai/human/tools/ppt/schemas'
import {
  renderToolInputSchemaForPrompt
} from '../../../../src/main/services/ai/human/tools/schemaPromptRenderer'

describe('ai unit tool input schema renderer', () => {
  it('renders every registered Human tool as plain TypeScript-like types', () => {
    const renderedByTool = Object.fromEntries(
      ALL_TOOL_SPECS.map((spec) => {
        const rendered = renderToolInputSchemaForPrompt(spec.inputSchema, { compact: true })
        expect(rendered).not.toMatch(/__schema\d+/)
        expect(rendered).not.toMatch(
          /minLength|maxLength|minimum|maximum|exclusiveMinimum|exclusiveMaximum|multipleOf|minItems|maxItems|minProperties|maxProperties|pattern|constraint=|integer/
        )
        expect(rendered.length).toBeGreaterThan(2)
        expect(rendered.length).toBeLessThan(50_000)
        return [spec.name, rendered]
      })
    )

    expect({
      terminal_run: renderedByTool.terminal_run,
      ppt_read_outline: renderedByTool.ppt_read_outline,
      ppt_edit: renderedByTool.ppt_edit,
      docx_edit: renderedByTool.docx_edit
    }).toMatchSnapshot()
  })

  it('hides runtime constraints while preserving TypeScript shapes', () => {
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

    expect(rendered).toBe('{ name: string, count: number, values: string[], code: string }')
  })

  it('renders DOCX shared definitions once without schema constraints', () => {
    const docxEdit = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_edit')!
    const docxVisuals = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_read_visuals')!
    const editRendered = renderToolInputSchemaForPrompt(docxEdit.inputSchema, { compact: true })
    const visualsRendered = renderToolInputSchemaForPrompt(docxVisuals.inputSchema, {
      compact: true
    })

    for (const definition of [
      'DocxRunStyle',
      'DocxParagraphStyle',
      'DocxTableStyle',
      'DocxTableRowStyle',
      'DocxTableCellStyle',
      'DocxEditAction'
    ]) {
      expect(editRendered.match(new RegExp(`type ${definition} =`, 'g'))).toHaveLength(1)
    }
    expect(visualsRendered).toBe(
      '{ sourcePath: string, requests: { visualId: string, instruction: string }[] }'
    )
    expect(editRendered).not.toMatch(/constraint=|minItems|hyperlink requires|style patch must/)
  })

  it('does not expose warnings in tool output schemas', () => {
    ;[
      docxOutlineOutputSchema,
      docxSearchOutputSchema,
      docxReadBlocksOutputSchema,
      docxWriteOutputSchema,
      pdfInspectOutputSchema,
      pdfSearchOutputSchema,
      pdfReadPagesOutputSchema,
      pptReadOutlineOutputSchema,
      pptReadSlidesOutputSchema,
      pptSearchOutputSchema,
      pptEditOutputSchema
    ].forEach((schema) => {
      expect(Object.keys(schema.shape)).not.toContain('warnings')
    })
  })
})
