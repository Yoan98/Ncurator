import { z } from 'zod/v4'
import { humanPlanItemSchema } from '../../schema'

export const LEARN_SKILL_SCHEMA = z.object({
  skillIds: z.array(z.string().min(1)).min(1).describe('要加载的技能 ID 列表')
})

export const LEARN_SKILL_OUTPUT_SCHEMA = z.object({
  message: z.string().describe('加载结果说明')
})

export const UPDATE_PLAN_SCHEMA = z.object({
  plan: z.array(humanPlanItemSchema).min(1).describe('任务计划条目'),
  progress: z.string().optional().describe('当前进度摘要')
})

export const UPDATE_PLAN_OUTPUT_SCHEMA = z.object({
  message: z.string().describe('更新结果说明')
})

export const READ_IMAGE_SCHEMA = z.object({
  paths: z
    .array(z.string().min(1))
    .min(1)
    .max(10)
    .describe('本地或远程图片路径，1 至 10 个')
})

export const READ_IMAGE_OUTPUT_SCHEMA = z.object({
  message: z.string().describe('加载结果说明'),
  images: z
    .array(
      z.object({
        path: z.string().min(1).describe('图片路径'),
        mimeType: z.string().min(1).describe('MIME 类型'),
        sizeBytes: z.number().int().positive().describe('文件字节数'),
        width: z.number().int().positive().describe('图片宽度（像素）'),
        height: z.number().int().positive().describe('图片高度（像素）')
      })
    )
    .describe('按输入顺序排列的图片元数据')
})
