import { StateSchema } from '@langchain/langgraph'
import { z } from 'zod/v4'
import { AI_DIRECTOR_STAGES, DIRECTOR_STATUSES } from '../../constants'
import { aiArtifactRefSchema, aiPlanTaskSchema } from '../../schema'
import { createDefaultAiRunStateFields } from '../../utils/state'

export const createDirectorRunStateSchema = () => {
  const defaults = createDefaultAiRunStateFields()

  return new StateSchema({
    runId: z.string(),
    sessionId: z.string(),
    status: z.enum(DIRECTOR_STATUSES).default(defaults.status),
    input: z.string(),
    directorStage: z.enum(AI_DIRECTOR_STAGES).default(defaults.directorStage),
    contextRounds: z.number().default(defaults.contextRounds),
    contextObjective: z.string().optional(),
    contextEvidence: z.array(z.string()).default(() => [...defaults.contextEvidence]),
    plan: z.array(aiPlanTaskSchema).default(() => [...defaults.plan]),
    dispatchCursor: z.number().default(defaults.dispatchCursor),
    error: z.string().optional(),
    finalDeliveryMarkdown: z.string().optional(),
    finalArtifacts: z.array(aiArtifactRefSchema).default(() => [...defaults.finalArtifacts])
  })
}
