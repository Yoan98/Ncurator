import type { AIMessage, BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { HumanTaskInput, JsonObject, JsonValue } from '../../../../shared/types'

export const createMainRunStateSchema = () => {
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)

  return new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    input: z.string(),
    mainStage: z
      .enum(['main_intent', 'main_context_enrich', 'main_plan', 'main_dispatch', 'main_finalize'])
      .default('main_intent'),
    contextRounds: z.number().default(0),
    contextObjective: z.string().optional(),
    contextEvidence: z.array(z.string()).default(() => []),
    plan: z
      .array(
        z.object({
          id: z.string(),
          title: z.string(),
          objective: z.string(),
          kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional(),
          status: z.enum(['pending', 'running', 'completed', 'failed']),
          attempts: z.number(),
          error: z.string().optional(),
          resultCode: z
            .enum([
              'ok',
              'failed',
              'workspace_required',
              'approval_denied',
              'bounded_loop_error',
              'invalid_input'
            ])
            .optional(),
          resultMessage: z.string().optional(),
          resultData: jsonObjectSchema.optional()
        })
      )
      .default(() => []),
    dispatchCursor: z.number().default(0),
    error: z.string().optional(),
    outputText: z.string().optional()
  })
}

export const createHumanRunStateSchema = () => {
  const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      z.null(),
      z.array(jsonValueSchema),
      z.record(z.string(), jsonValueSchema)
    ])
  )
  const jsonObjectSchema: z.ZodType<JsonObject> = z.record(z.string(), jsonValueSchema)
  const humanTaskInputSchema: z.ZodType<HumanTaskInput> = z.object({
    taskId: z.string(),
    mode: z.enum(['context', 'dispatch']),
    objective: z.string(),
    kindHint: z.enum(['local_kb_retrieval', 'terminal_exec', 'docx']).optional()
  })

  return new StateSchema({
    runId: z.string(),
    input: humanTaskInputSchema,
    phase: z.enum(['brain', 'tool_exec']).default('brain'),
    terminalState: z.enum(['running', 'completed', 'blocked']).default('running'),
    steps: z.number().default(0),
    maxSteps: z.number().default(6),
    messages: z
      .array(z.custom<BaseMessage>((value) => typeof value === 'object' && value !== null))
      .default(() => []),
    activeTools: z
      .array(
        z.custom<StructuredToolInterface>((value) => typeof value === 'object' && value !== null)
      )
      .default(() => []),
    lastAiMessage: z
      .custom<AIMessage>((value) => typeof value === 'object' && value !== null)
      .optional(),
    lastToolName: z.string().optional(),
    summary: z.string().default(''),
    resultCode: z
      .enum([
        'ok',
        'failed',
        'workspace_required',
        'approval_denied',
        'bounded_loop_error',
        'invalid_input'
      ])
      .default('failed'),
    resultData: jsonObjectSchema.optional()
  })
}
