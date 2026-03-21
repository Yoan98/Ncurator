import { z } from 'zod/v4'
import { lastBrainDecisionSchema } from '../../schema'
import type { LastBrainDecision } from '../../types'

export const brainDecisionOutputSchema: z.ZodType<LastBrainDecision> = lastBrainDecisionSchema

export const parseBrainDecisionOutput = (rawOutput: LastBrainDecision): LastBrainDecision =>
  brainDecisionOutputSchema.parse(rawOutput)
