import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiRunFailureCode,
  AiFileReviewArtifactRef,
  AiFileReviewRef,
  AiFileArtifactRef
} from '../../../shared/types'
import { AI_RUN_STATUSES } from './constants'

export const aiFileReviewRefSchema: z.ZodType<AiFileReviewRef> = z.object({
  reviewId: z.string().min(1),
  changeCount: z.number().int().min(0)
})

export const aiFileArtifactRefSchema: z.ZodType<AiFileArtifactRef> = z.object({
  kind: z.literal('file'),
  capability: z.enum(['terminal_exec', 'docx']),
  path: z.string().min(1),
  fileName: z.string().min(1),
  operation: z.enum(['created', 'updated']),
  artifactRole: z.enum(['draft', 'committed']).optional(),
  reviewId: z.string().min(1).optional(),
  draftSnapshotId: z.string().min(1).optional(),
  summary: z.string().min(1)
})

export const aiFileReviewArtifactRefSchema: z.ZodType<AiFileReviewArtifactRef> = z.object({
  kind: z.literal('draft_review'),
  review: aiFileReviewRefSchema,
  summary: z.string().min(1)
})

export const aiArtifactRefSchema: z.ZodType<AiArtifactRef> = z.union([
  aiFileArtifactRefSchema,
  aiFileReviewArtifactRefSchema
])

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
