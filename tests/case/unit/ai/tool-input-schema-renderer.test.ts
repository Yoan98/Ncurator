import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { ALL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/registry'
import {
  docxReadOutputSchema,
  docxOutlineOutputSchema,
  docxSearchOutputSchema,
  docxMutationOutputSchema
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
import { renderToolInputSchemaForPrompt } from '../../../../src/main/services/ai/human/tools/schemaPromptRenderer'

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
      docx_content_edit: renderedByTool.docx_content_edit,
      docx_format: renderedByTool.docx_format,
      docx_table_edit: renderedByTool.docx_table_edit
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
    const docxFormat = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_format')!
    const docxTableEdit = ALL_TOOL_SPECS.find((spec) => spec.name === 'docx_table_edit')!
    const formatRendered = renderToolInputSchemaForPrompt(docxFormat.inputSchema, { compact: true })
    const tableRendered = renderToolInputSchemaForPrompt(docxTableEdit.inputSchema, {
      compact: true
    })

    for (const definition of ['DocxRunStyle', 'DocxParagraphStyle']) {
      expect(formatRendered.match(new RegExp(`type ${definition} =`, 'g'))).toHaveLength(1)
    }
    for (const definition of ['DocxTableStyle', 'DocxTableRowStyle', 'DocxTableCellStyle']) {
      expect(tableRendered.match(new RegExp(`type ${definition} =`, 'g'))).toHaveLength(1)
    }
    expect(formatRendered).not.toMatch(/constraint=|minItems|hyperlink requires|style patch must/)
  })

  it('does not expose warnings in tool output schemas', () => {
    ;[
      docxOutlineOutputSchema,
      docxSearchOutputSchema,
      docxReadOutputSchema,
      docxMutationOutputSchema,
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

  it('keeps DOCX mutation results minimal', () => {
    expect(docxMutationOutputSchema.safeParse({}).success).toBe(true)
    expect(docxMutationOutputSchema.safeParse({ createdIds: ['node_1'] }).success).toBe(true)
    expect(docxMutationOutputSchema.safeParse({ createdIds: [] }).success).toBe(false)
    expect(docxMutationOutputSchema.safeParse({ changes: [] }).success).toBe(false)
  })
})
