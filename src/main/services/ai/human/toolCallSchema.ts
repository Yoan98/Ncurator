import { z, ZodError } from 'zod/v4'
import type { JsonObject } from '../../../../shared/types'
import { HUMAN_HAND_CALL_LIMIT } from './constants'
import { getToolSpec } from './tools/registry'
import { jsonObjectSchema } from './toolSchemas'

const FALLBACK_TOOL_CALL_SCHEMA = z.object({
  toolName: z.string().min(1),
  args: jsonObjectSchema
})

const buildToolCallOptionSchema = (toolName: string) => {
  const spec = getToolSpec(toolName)
  if (!spec) {
    return z.object({
      toolName: z.literal(toolName),
      args: jsonObjectSchema
    })
  }

  return z.object({
    toolName: z.literal(toolName),
    args: spec.inputSchema
  })
}

export const createToolCallSchema = (toolNames: readonly string[]) => {
  const normalizedToolNames = Array.from(
    new Set(
      toolNames
        .map((toolName) => String(toolName || '').trim())
        .filter((toolName) => toolName.length > 0)
    )
  )

  if (normalizedToolNames.length === 0) {
    return FALLBACK_TOOL_CALL_SCHEMA
  }

  if (normalizedToolNames.length === 1) {
    return buildToolCallOptionSchema(normalizedToolNames[0])
  }

  type ToolCallOptionSchema = ReturnType<typeof buildToolCallOptionSchema>
  return z.discriminatedUnion(
    'toolName',
    normalizedToolNames.map((toolName) => buildToolCallOptionSchema(toolName)) as unknown as [
      ToolCallOptionSchema,
      ToolCallOptionSchema,
      ...ToolCallOptionSchema[]
    ]
  )
}

export const createHandCallsSchema = (toolNames: readonly string[]) =>
  z.array(createToolCallSchema(toolNames)).min(1).max(HUMAN_HAND_CALL_LIMIT)

export type ToolCallSchemaIssue = {
  path: string
  message: string
}

export type ToolCallSchemaError = {
  summary: string
  issues: ToolCallSchemaIssue[]
  guidance: string
  message: string
}

const MAX_ISSUES = 3
const DEFAULT_GUIDANCE =
  'calls[*].args 必须直接等于对应工具的输入参数对象，禁止再次嵌套 toolName 或 args。'

const formatPathPart = (value: string | number): string =>
  typeof value === 'number' ? `[${String(value)}]` : /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? `.${value}` : `["${String(value)}"]`

const formatIssuePath = (path: readonly (string | number)[], prefix?: string): string => {
  const base = path.length > 0 ? path.map(formatPathPart).join('').replace(/^\./, '') : ''
  const full = [prefix, base].filter(Boolean).join('.').replace(/\.?\[/g, '[')
  return full || prefix || 'unknown'
}

export const formatToolCallSchemaError = (input: {
  error: unknown
  pathPrefix?: string
}): ToolCallSchemaError => {
  const issues =
    input.error instanceof ZodError
      ? input.error.issues
          .slice(0, MAX_ISSUES)
          .map((issue) => ({
            path: formatIssuePath(issue.path.filter((item): item is string | number => typeof item === 'string' || typeof item === 'number'), input.pathPrefix),
            message: issue.message
          }))
      : [
          {
            path: input.pathPrefix || 'unknown',
            message: input.error instanceof Error ? input.error.message : String(input.error)
          }
        ]

  const message = ['tool call schema invalid', ...issues.map((issue) => `${issue.path}: ${issue.message}`)]
    .join('\n')
    .trim()

  return {
    summary: 'tool call schema invalid',
    issues,
    guidance: DEFAULT_GUIDANCE,
    message
  }
}

export const readParsedSourcePath = (args: JsonObject): string | undefined =>
  typeof args.sourcePath === 'string' && args.sourcePath.trim().length > 0 ? args.sourcePath : undefined
