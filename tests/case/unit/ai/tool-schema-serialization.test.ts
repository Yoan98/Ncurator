import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import { describe, expect, it } from 'vitest'
import { attachProviderToolDefinitions } from '../../../../src/main/services/ai/human/tools/utils/toolSchemaSerialization'

describe('ai unit tool schema serialization', () => {
  it('adds root type object for root-level discriminatedUnion tool schemas', () => {
    const editSchema = z.discriminatedUnion('action', [
      z.object({ sourcePath: z.string(), action: z.literal('create'), content: z.string() }),
      z.object({
        sourcePath: z.string(),
        action: z.literal('edit'),
        edits: z.array(z.object({ oldText: z.string(), newText: z.string() })).min(1)
      })
    ])
    const editTool = tool(
      async (args) => String(args.sourcePath),
      { name: 'text_file_edit', description: 'edit text file', schema: editSchema }
    )

    attachProviderToolDefinitions([editTool])

    const definition = editTool.extras?.providerToolDefinition as
      | {
          type: 'function'
          function: { name: string; parameters: Record<string, unknown> }
        }
      | undefined
    expect(definition?.type).toBe('function')
    expect(definition?.function.name).toBe('text_file_edit')
    expect(definition?.function.parameters.type).toBe('object')
    expect(Array.isArray(definition?.function.parameters.oneOf)).toBe(true)
    expect(definition?.function.parameters.oneOf).toHaveLength(2)
  })

  it('keeps object-rooted tool schemas unchanged without providerToolDefinition', () => {
    const readSchema = z.object({ sourcePath: z.string() }).strict()
    const readTool = tool(
      async (args) => String(args.sourcePath),
      { name: 'text_file_read', description: 'read text file', schema: readSchema }
    )

    attachProviderToolDefinitions([readTool])

    expect(readTool.extras?.providerToolDefinition).toBeUndefined()
  })

  it('keeps original zod schema validation intact after attaching definition', () => {
    const editSchema = z.discriminatedUnion('action', [
      z.object({ sourcePath: z.string(), action: z.literal('create'), content: z.string() })
    ])
    const editTool = tool(
      async (args) => String(args.sourcePath),
      { name: 'text_file_edit', description: 'edit text file', schema: editSchema }
    )

    attachProviderToolDefinitions([editTool])

    expect(editSchema.safeParse({ sourcePath: 'a.md', action: 'create', content: 'x' }).success).toBe(
      true
    )
    expect(editSchema.safeParse({ sourcePath: 'a.md', action: 'edit' }).success).toBe(false)
  })
})
