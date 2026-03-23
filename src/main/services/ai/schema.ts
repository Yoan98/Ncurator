import { z } from 'zod/v4'
import type {
  AiArtifactRef,
  AiDraftReviewArtifactRef,
  AiDraftReviewRef,
  AiFileArtifactRef,
  AiPlanTask
} from '../../../shared/types'
import { AI_DIRECTOR_STAGES, DIRECTOR_STATUSES, PLAN_TASK_STATUSES } from './constants'

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

export const directorStatusSchema = z.enum(DIRECTOR_STATUSES)
export const aiDirectorStageSchema = z.enum(AI_DIRECTOR_STAGES)
export const planTaskStatusSchema = z.enum(PLAN_TASK_STATUSES)

export const aiPlanTaskSchema: z.ZodType<AiPlanTask> = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  userInput: z.string().min(1),
  status: planTaskStatusSchema,
  deliveryMarkdown: z.string().min(1).optional(),
  artifacts: z.array(aiArtifactRefSchema).optional()
})

export const aiRunStateFieldSchemas = {
  runId: z.string(),
  sessionId: z.string(),
  status: directorStatusSchema,
  input: z.string(),
  directorStage: aiDirectorStageSchema,
  contextRounds: z.number(),
  contextObjective: z.string().optional(),
  contextEvidence: z.array(z.string()),
  plan: z.array(aiPlanTaskSchema),
  dispatchCursor: z.number(),
  error: z.string().optional(),
  finalDeliveryMarkdown: z.string().optional(),
  finalArtifacts: z.array(aiArtifactRefSchema)
}

export const aiRunStateContractSchema = z.object(aiRunStateFieldSchemas)
