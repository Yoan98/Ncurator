import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import { humanPlanItemSchema } from '../../schema'
import {
  renderLearnSkillModelResult,
  renderPlanUpdateModelResult
} from '../../shared/modelToolResultRenderers'

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
      sizeBytes: z.number().int().nonnegative().optional(),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional()
    })
  )
})

export const LEARN_SKILL_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LEARN_SKILL_SCHEMA>,
  z.infer<typeof LEARN_SKILL_OUTPUT_SCHEMA>,
  'learn_skill',
  'agent-control'
> = {
  name: 'learn_skill',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: LEARN_SKILL_SCHEMA,
  outputSchema: LEARN_SKILL_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'learn_skill',
    description: '学习一个或多个尚未学习的技能，学习后即可使用该技能对应的工具。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderLearnSkillModelResult }
}

export const UPDATE_PLAN_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof UPDATE_PLAN_SCHEMA>,
  z.infer<typeof UPDATE_PLAN_OUTPUT_SCHEMA>,
  'update_plan',
  'agent-control'
> = {
  name: 'update_plan',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: UPDATE_PLAN_SCHEMA,
  outputSchema: UPDATE_PLAN_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'update_plan',
    description: '更新当前任务的执行计划。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  }),
  modelResult: { renderSuccess: renderPlanUpdateModelResult }
}

export const READ_IMAGE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof READ_IMAGE_SCHEMA>,
  z.infer<typeof READ_IMAGE_OUTPUT_SCHEMA>,
  'read_image',
  'agent-control'
> = {
  name: 'read_image',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: READ_IMAGE_SCHEMA,
  outputSchema: READ_IMAGE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'read_image',
    description:
      '读取 1 至 10 张本地或远程图片，并把图片按输入顺序直接加入当前主模型上下文。工具不生成图片描述。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'image'
  })
}

export const AGENT_CONTROL_TOOL_SPECS = [
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC
] as const
