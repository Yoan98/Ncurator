import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiRunFailureCode,
  AiRunFailureSource,
  AiFileArtifactRef
} from '../../../shared/types'
import { AI_RUN_STATUSES } from './constants'

export const aiFileArtifactRefSchema: z.ZodType<AiFileArtifactRef> = z.object({
  kind: z.literal('file'),
  capability: z.enum(['terminal_exec', 'docx', 'ppt', 'excel', 'text_file']),
  path: z.string().min(1),
  fileName: z.string().min(1),
  operation: z.enum(['created', 'updated', 'deleted', 'renamed']),
  applyId: z.string().min(1).optional()
})

export const aiArtifactRefSchema: z.ZodType<AiArtifactRef> = aiFileArtifactRefSchema

export const aiRunStatusSchema = z.enum(AI_RUN_STATUSES)

export const aiRunStateFieldSchemas = {
  runId: z.string(),
  sessionId: z.string(),
  status: aiRunStatusSchema,
  input: z.string(),
  error: z.string().optional(),
  failureSource: z.custom<AiRunFailureSource>().optional(),
  failureHttpStatus: z.number().int().optional(),
  failureProviderCode: z.string().optional(),
  failureCode: z.custom<AiRunFailureCode>().optional(),
  resumeSnapshotSaved: z.boolean().optional(),
  finalDeliveryMarkdown: z.string().optional(),
  finalArtifacts: z.array(aiArtifactRefSchema)
}

export const aiRunStateContractSchema = z.object(aiRunStateFieldSchemas)
