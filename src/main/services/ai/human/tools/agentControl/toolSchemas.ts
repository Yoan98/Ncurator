import { z } from 'zod/v4'
import { humanPlanItemSchema } from '../../schema'

export const LEARN_SKILL_SCHEMA = z.object({
  skillIds: z.array(z.string().min(1)).min(1)
})

export const LEARN_SKILL_OUTPUT_SCHEMA = z.object({
  message: z.string()
})

export const UPDATE_PLAN_SCHEMA = z.object({
  plan: z.array(humanPlanItemSchema).min(1),
  progress: z.string().optional()
})

export const UPDATE_PLAN_OUTPUT_SCHEMA = z.object({
  message: z.string()
})

export const READ_IMAGE_SCHEMA = z.object({
  paths: z.array(z.string().min(1)).min(1).max(10)
})

export const READ_IMAGE_OUTPUT_SCHEMA = z.object({
  message: z.string(),
  images: z.array(
    z.object({
      path: z.string().min(1),
      mimeType: z.string().min(1),
      sizeBytes: z.number().int().positive(),
      width: z.number().int().positive(),
      height: z.number().int().positive()
    })
  )
})
