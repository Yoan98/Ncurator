import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiRunFailureCode,
  AiFileArtifactRef
} from '../../../shared/types'
import { AI_RUN_STATUSES } from './constants'

export const aiFileArtifactRefSchema: z.ZodType<AiFileArtifactRef> = z.object({
  kind: z.literal('file'),
  capability: z.enum(['terminal_exec', 'docx']),
  path: z.string().min(1),
  fileName: z.string().min(1),
  operation: z.enum(['created', 'updated']),
  applyId: z.string().min(1).optional(),
  summary: z.string().min(1)
})

export const aiArtifactRefSchema: z.ZodType<AiArtifactRef> = aiFileArtifactRefSchema

export const aiRunStatusSchema = z.enum(AI_RUN_STATUSES)

export const aiRunStateFieldSchemas = {
  runId: z.string(),
  sessionId: z.string(),
  status: aiRunStatusSchema,
  input: z.string(),
  error: z.string().optional(),
  failureCode: z.custom<AiRunFailureCode>().optional(),
  resumeSnapshotSaved: z.boolean().optional(),
  finalDeliveryMarkdown: z.string().optional(),
  finalArtifacts: z.array(aiArtifactRefSchema)
}

export const aiRunStateContractSchema = z.object(aiRunStateFieldSchemas)
