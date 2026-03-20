import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'

export const createMainRunStateSchema = () => {
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
          userInput: z.string(),
          status: z.enum(['ready', 'running', 'completed', 'blocked']),
          deliveryMarkdown: z.string().optional()
        })
      )
      .default(() => []),
    dispatchCursor: z.number().default(0),
    error: z.string().optional(),
    finalDeliveryMarkdown: z.string().optional()
  })
}
