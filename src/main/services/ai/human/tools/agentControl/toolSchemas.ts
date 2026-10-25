import { z } from 'zod/v4'
import { humanPlanItemSchema } from '../../schema'

export const LIST_AGENT_SCHEMA = z.object({}).strict()

export const DELEGATE_TO_SUBAGENT_SCHEMA = z.object({
  agents: z
    .array(
      z.union([
        z
          .object({
            name: z
              .string()
              .trim()
              .min(1)
              .max(8)
              .describe('创建新子agent的名称，不能同时提供 agentId'),
            instruction: z.string().trim().min(1).describe('交给子agent执行的完整工作指令')
          })
          .strict(),
        z
          .object({
            agentId: z
              .string()
              .trim()
              .min(1)
              .describe('续接已有子agent的agentId，不能同时提供 name'),
            instruction: z.string().trim().min(1).describe('交给子agent执行的完整工作指令')
          })
          .strict()
      ])
    )
    .min(1)
    .describe('本次分配的子agent列表')
})

export const LOAD_TOOLSET_SCHEMA = z
  .object({
    toolsetNames: z.array(z.string().min(1)).min(1).describe('要加载的工具组名称列表')
  })
  .strict()

export const LOAD_SKILL_SCHEMA = z
  .object({
    skillNames: z.array(z.string().min(1)).min(1).describe('要加载的技能名称列表')
  })
  .strict()

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
        question: z.string().min(1).describe('向用户询问的信息'),
        options: z
          .array(
            z.object({
              id: z.string().min(1).describe('选项的稳定标识'),
              label: z.string().min(1).describe('用户看到的选项文字'),
              description: z.string().min(1).optional().describe('该方案的解释描述'),
              recommended: z.boolean().optional().describe('是否推荐该方案')
            })
          )
          .max(4)
          .optional()
          .describe(
            '对应问题的答案选项列表;最多 4 个，也可为空数组，当为空数组时代表只是询问用户问题不需要给出选项，用户会自由回答'
          ),
        multiSelect: z.boolean().optional().describe('是否允许同时选择多个方案')
      })
    )
    .min(1)
    .max(3)
    .describe('询问用户的问题列表')
})

export type AskUserQuestionInput = z.infer<typeof ASK_USER_QUESTION_SCHEMA>

export type {
  LoadToolsetOutput,
  ReadImageItem,
  ReadImageOutput,
  UpdatePlanOutput
} from './outputTypes'
