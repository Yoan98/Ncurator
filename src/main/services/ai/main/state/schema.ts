import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../../shared/types'

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
      .enum([
        'main_intent',
        'main_context_human',
        'main_plan',
        'main_plan_exec',
        'main_direct_human_exec',
        'main_synthesis_human',
        'main_complete'
      ])
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
          deliveryMarkdown: z.string().optional(),
          resultData: jsonObjectSchema.optional()
        })
      )
      .default(() => []),
    dispatchCursor: z.number().default(0),
    error: z.string().optional(),
    finalDeliveryMarkdown: z.string().optional(),
    finalDeliveryTaskId: z.string().optional(),
    localSourceStatus: z.enum(['used', 'not_used', 'insufficient']).optional(),
    localSourceSummary: z.string().optional()
  })
}
