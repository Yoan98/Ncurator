import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { aiArtifactRefSchema, aiPlanTaskSchema } from '../../schema'

export const createDirectorRunStateSchema = () => {
  return new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(['running', 'completed', 'failed', 'cancelled']).default('running'),
    input: z.string(),
    directorStage: z
      .enum([
        'director_intent',
        'director_context_human',
        'director_plan',
        'director_plan_exec',
        'director_direct_human_exec',
        'director_synthesis_human',
        'director_complete'
      ])
      .default('director_intent'),
    contextRounds: z.number().default(0),
    contextObjective: z.string().optional(),
    contextEvidence: z.array(z.string()).default(() => []),
    plan: z.array(aiPlanTaskSchema).default(() => []),
    dispatchCursor: z.number().default(0),
    error: z.string().optional(),
    finalDeliveryMarkdown: z.string().optional(),
    finalArtifacts: z.array(aiArtifactRefSchema).default(() => [])
  })
}
