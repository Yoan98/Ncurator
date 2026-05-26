import { describe, expect, it } from 'vitest'
import { createToolCallSchema, formatToolCallSchemaDiagnostic } from '../../../src/main/services/ai/human/toolCallSchema'

describe('ai unit tool call schema', () => {
  it('accepts a valid docx_create call and rejects nested args wrappers', () => {
    const schema = createToolCallSchema(['docx_create', 'terminal_run'])

    expect(
      schema.parse({
        toolName: 'docx_create',
        args: {
          sourcePath: 'report.docx',
          blocks: [
            {
              type: 'paragraph',
              text: 'hello'
            }
          ]
        }
      })
    ).toMatchObject({
      toolName: 'docx_create'
    })

    const nested = schema.safeParse({
      toolName: 'docx_create',
      args: {
        toolName: 'docx_create',
        args: {
          sourcePath: 'report.docx',
          blocks: [
            {
              type: 'paragraph',
              text: 'hello'
            }
          ]
        }
      }
    })

    expect(nested.success).toBe(false)
    if (nested.success) return

    const diagnostic = formatToolCallSchemaDiagnostic({
      error: nested.error,
      pathPrefix: 'nextAction.calls[1].args'
    })

    expect(diagnostic.summary).toBe('tool call schema invalid')
    expect(diagnostic.issues[0]?.path).toContain('nextAction.calls[1].args')
    expect(diagnostic.message).toContain('tool call schema invalid')
  })
})
