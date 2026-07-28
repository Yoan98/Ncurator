import { describe, expect, it } from 'vitest'
import {
  createToolCallSchema,
  formatToolCallSchemaError
} from '../../../../src/main/services/ai/human/toolCallSchema'

describe('ai unit tool call schema', () => {
  it('accepts a valid docx_edit insert_blocks call and rejects nested args wrappers', () => {
    const schema = createToolCallSchema(['docx_edit', 'terminal_run'])

    expect(
      schema.parse({
        toolName: 'docx_edit',
        args: {
          sourcePath: 'report.docx',
          actions: [
            {
              type: 'insert_blocks',
              position: 'after',
              blocks: [
                {
                  type: 'paragraph',
                  text: 'hello'
                }
              ]
            }
          ]
        }
      })
    ).toMatchObject({
      toolName: 'docx_edit'
    })

    const nested = schema.safeParse({
      toolName: 'docx_edit',
      args: {
        toolName: 'docx_edit',
        args: {
          sourcePath: 'report.docx',
          actions: [
            {
              type: 'insert_blocks',
              position: 'after',
              blocks: [
                {
                  type: 'paragraph',
                  text: 'hello'
                }
              ]
            }
          ]
        }
      }
    })

    expect(nested.success).toBe(false)
    if (nested.success) return

    const schemaError = formatToolCallSchemaError({
      error: nested.error,
      pathPrefix: 'nextAction.calls[1].args'
    })

    expect(schemaError.summary).toBe('tool call schema invalid')
    expect(schemaError.issues[0]?.path).toContain('nextAction.calls[1].args')
    expect(schemaError.message).toContain('tool call schema invalid')
  })
})
