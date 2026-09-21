import { z } from 'zod/v4'
import { humanPlanItemSchema } from '../../schema'

export const LEARN_SKILL_SCHEMA = z.object({
  skillIds: z.array(z.string().min(1)).min(1).describe('要加载的技能 ID 列表')
})

export const UPDATE_PLAN_SCHEMA = z.object({
  plan: z.array(humanPlanItemSchema).min(1).describe('任务计划条目')
})

export const READ_IMAGE_SCHEMA = z.object({
  paths: z.array(z.string().min(1)).min(1).max(10).describe('本地或远程图片路径，1 至 10 个')
})

export const ASK_USER_QUESTION_SCHEMA = z.object({
  questions: z
    .array(
      z.object({
        id: z.string().min(1).describe('问题的稳定标识'),
        question: z.string().min(1).describe('需要用户回答的问题'),
        options: z
          .array(
            z.object({
              id: z.string().min(1).describe('选项的稳定标识'),
              label: z.string().min(1).describe('用户看到的选项文字'),
              description: z.string().min(1).optional().describe('选项影响说明'),
              recommended: z.boolean().optional().describe('是否为推荐方案')
            })
          )
          .min(1)
          .describe('供用户选择的具体方案；方案之间应有明确差异'),
        multiSelect: z.boolean().optional().describe('是否允许同时选择多个选项')
      })
    )
    .min(1)
    .max(3)
    .describe('询问用户的问题列表')
})

export type AskUserQuestionInput = z.infer<typeof ASK_USER_QUESTION_SCHEMA>
export type AskUserQuestionResult = {
  answers: Array<{ id: string; selected: string[]; custom?: string }>
}

export type {
  LearnSkillOutput,
  ReadImageItem,
  ReadImageOutput,
  UpdatePlanOutput
} from './outputTypes'
