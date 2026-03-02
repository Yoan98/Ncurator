import { AIMessage } from '@langchain/core/messages'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v4'
import type { JsonObject } from '../../../../../shared/types'
import type { AiHostAction, AiHostCreatePlanTaskInput } from '../../types'

const capabilityKindSchema = z.enum(['local_kb_retrieval', 'terminal_exec', 'docx'])

const createPlanTaskInputSchema: z.ZodType<AiHostCreatePlanTaskInput> = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  kind: z.string().optional(),
  input: z.string().optional(),
  objective: z.string().optional(),
  preferredCwd: z.string().optional(),
  sourcePath: z.string().optional(),
  outputPath: z.string().optional()
})

const retrieveContextArgsSchema = z.object({
  capabilityKind: capabilityKindSchema,
  objective: z.string().min(1),
  preferredCwd: z.string().optional(),
  sourcePath: z.string().optional(),
  outputPath: z.string().optional()
})

const createPlanArgsSchema = z.object({
  tasks: z.array(createPlanTaskInputSchema).default([])
})

const finalAnswerArgsSchema = z.object({
  answer: z.string().optional()
})

const fallbackActionSchema: z.ZodType<AiHostAction> = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('retrieve_context'),
    capabilityKind: capabilityKindSchema,
    objective: z.string().min(1),
    preferredCwd: z.string().optional(),
    sourcePath: z.string().optional(),
    outputPath: z.string().optional()
  }),
  z.object({
    action: z.literal('create_plan'),
    tasks: z.array(createPlanTaskInputSchema).default([])
  }),
  z.object({
    action: z.literal('final_answer'),
    answer: z.string().optional()
  })
])

const parseJsonObject = (text: string): JsonObject | null => {
  const trimmed = String(text || '').trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as JsonObject
  } catch (err) {
    void err
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as JsonObject
  } catch (err) {
    void err
  }
  return null
}

export const buildHostActionTools = () => {
  const retrieveContext = tool(
    async (args) => args,
    {
      name: 'retrieve_context',
      description:
        'Request context enrichment before planning/final answer. Select one capability kind and provide objective.',
      schema: retrieveContextArgsSchema
    }
  )

  const createPlan = tool(
    async (args) => args,
    {
      name: 'create_plan',
      description: 'Create executable capability tasks for plan execution.',
      schema: createPlanArgsSchema
    }
  )

  const finalAnswer = tool(
    async (args) => args,
    {
      name: 'final_answer',
      description: 'Finish run with direct answer without creating execution plan.',
      schema: finalAnswerArgsSchema
    }
  )

  return [retrieveContext, createPlan, finalAnswer]
}

export const parseHostActionFromToolMessage = (message: AIMessage): AiHostAction | null => {
  const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
  const first = calls[0]
  if (!first) return null

  if (first.name === 'retrieve_context') {
    const parsed = retrieveContextArgsSchema.safeParse(first.args)
    if (!parsed.success) return null
    return {
      action: 'retrieve_context',
      capabilityKind: parsed.data.capabilityKind,
      objective: parsed.data.objective,
      preferredCwd: parsed.data.preferredCwd,
      sourcePath: parsed.data.sourcePath,
      outputPath: parsed.data.outputPath
    }
  }

  if (first.name === 'create_plan') {
    const parsed = createPlanArgsSchema.safeParse(first.args)
    if (!parsed.success) return null
    return {
      action: 'create_plan',
      tasks: parsed.data.tasks
    }
  }

  if (first.name === 'final_answer') {
    const parsed = finalAnswerArgsSchema.safeParse(first.args)
    if (!parsed.success) return null
    return {
      action: 'final_answer',
      answer: parsed.data.answer
    }
  }

  return null
}

export const parseHostActionFromFallbackText = (text: string): AiHostAction | null => {
  const obj = parseJsonObject(text)
  if (!obj) return null
  const parsed = fallbackActionSchema.safeParse(obj)
  if (!parsed.success) return null
  return parsed.data
}
