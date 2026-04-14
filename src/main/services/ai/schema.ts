import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiDraftReviewArtifactRef,
  AiDraftReviewRef,
  AiFileArtifactRef
} from '../../../shared/types'
import { AI_RUN_STATUSES } from './constants'

export const aiDraftReviewRefSchema: z.ZodType<AiDraftReviewRef> = z.object({
  reviewId: z.string().min(1),
  documentCount: z.number().int().min(0),
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
  draftDocumentId: z.string().min(1).optional(),
  draftSnapshotId: z.string().min(1).optional(),
  summary: z.string().min(1)
})

export const aiDraftReviewArtifactRefSchema: z.ZodType<AiDraftReviewArtifactRef> = z.object({
  kind: z.literal('draft_review'),
  review: aiDraftReviewRefSchema,
  summary: z.string().min(1)
})

export const aiArtifactRefSchema: z.ZodType<AiArtifactRef> = z.union([
  aiFileArtifactRefSchema,
  aiDraftReviewArtifactRefSchema
])

export const aiRunStatusSchema = z.enum(AI_RUN_STATUSES)

export const aiRunStateFieldSchemas = {
  runId: z.string(),
  sessionId: z.string(),
  status: aiRunStatusSchema,
  input: z.string(),
  error: z.string().optional(),
  finalDeliveryMarkdown: z.string().optional(),
  finalArtifacts: z.array(aiArtifactRefSchema)
}

export const aiRunStateContractSchema = z.object(aiRunStateFieldSchemas)
