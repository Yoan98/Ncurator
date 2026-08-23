import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const LEARN_SKILL_SCHEMA = z.object({
  skillIds: z.array(z.string().min(1)).min(1)
})

export const LEARN_SKILL_OUTPUT_SCHEMA = z.object({
  message: z.string()
})

export const UPDATE_PLAN_SCHEMA = z.object({
  plan: z
    .array(
      z.object({
        title: z.string().min(1),
        status: z.enum(['todo', 'done'])
      })
    )
    .min(1),
  progress: z.string().optional()
})

export const UPDATE_PLAN_OUTPUT_SCHEMA = z.object({
  message: z.string()
})

export const FINISH_SCHEMA = z.object({
  reason: z.string().min(1),
  evidenceReferences: z
    .array(
      z.object({
        label: z.string().min(1),
        path: z.string().min(1),
        resourceType: z.enum(['file', 'web']),
        usedFor: z.string().min(1)
      })
    )
    .optional()
})

export const FINISH_OUTPUT_SCHEMA = z.object({
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

export const FINISH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof FINISH_SCHEMA>,
  z.infer<typeof FINISH_OUTPUT_SCHEMA>,
  'finish',
  'agent-control'
> = {
  name: 'finish',
  familyId: 'agent-control',
  skillIds: ['agent-control'],
  inputSchema: FINISH_SCHEMA,
  outputSchema: FINISH_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'finish',
    description:
      '仅在完成任务、或需要用户协助或确认时调用，结束本轮。reason 说明结束原因。若交付引用了可追溯的资料（本地文件或网页），必须在 evidenceReferences 中列出（label 为资料名、path 为可追溯地址、resourceType 为 file 或 web、usedFor 说明支撑了哪部分交付内容）。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'agent-control'
  })
}

export const AGENT_CONTROL_TOOL_SPECS = [
  LEARN_SKILL_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC,
  FINISH_TOOL_SPEC
] as const
