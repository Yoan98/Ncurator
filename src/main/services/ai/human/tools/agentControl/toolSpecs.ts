import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
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
  })
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
    description: '初始化或更新当前任务的执行计划。仅当计划项状态或内容变化时才更新'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  })
}

export const AGENT_CONTROL_TOOL_SPECS = [
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC
] as const
