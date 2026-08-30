import { z } from 'zod/v4'
import { humanPlanItemSchema } from '../../schema'

export const LEARN_SKILL_SCHEMA = z.object({
  skillIds: z.array(z.string().min(1)).min(1).describe('要加载的技能 ID 列表')
})

export type LearnSkillOutput = Record<string, never>

export const UPDATE_PLAN_SCHEMA = z.object({
  plan: z.array(humanPlanItemSchema).min(1).describe('任务计划条目'),
  progress: z.string().optional().describe('当前进度摘要')
})

export type UpdatePlanOutput = Record<string, never>

export const READ_IMAGE_SCHEMA = z.object({
  paths: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe('本地或远程图片路径，1 至 10 个')
})

export type ReadImageItem = {
  path: string
  mimeType: string
  sizeBytes: number
  width: number
  height: number
}

export type ReadImageOutput = {
  message: string
  images: ReadImageItem[]
}
