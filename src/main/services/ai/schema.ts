import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiDraftReviewArtifactRef,
  AiDraftReviewRef,
  AiFileArtifactRef,
  AiPlanTask
} from '../../../shared/types'
import { PLAN_TASK_STATUSES } from './constants'

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
  artifactRole: z.enum(['preview', 'draft', 'committed']).optional(),
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

export const aiPlanTaskSchema: z.ZodType<AiPlanTask> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  userInput: z.string().min(1),
  status: z.enum(PLAN_TASK_STATUSES),
  deliveryMarkdown: z.string().min(1).optional(),
  artifacts: z.array(aiArtifactRefSchema).optional()
})
