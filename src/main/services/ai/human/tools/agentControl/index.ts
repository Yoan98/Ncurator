import { tool } from '@langchain/core/tools'
import type { ToolFamilyDefinition } from '../types'
import { FINISH_TOOL_SPEC, LEARN_SKILL_TOOL_SPEC, UPDATE_PLAN_TOOL_SPEC } from './toolSpecs'

// agent-control 工具只用于让模型通过原生 tool call 表达控制意图（学习技能、更新计划、完成交付），
// 真正的副作用由对应节点（learning / hand / mouth）按工具名拦截处理，因此这里的 func 只是兜底占位。
export const agentControlToolFamily: ToolFamilyDefinition = {
  familyId: 'agent-control',
  buildTools: () => {
    const learnSkill = tool(
      async () => ({ message: 'learn_skill handled by learning node' }),
      {
        name: LEARN_SKILL_TOOL_SPEC.name,
        description: LEARN_SKILL_TOOL_SPEC.promptSpec.description,
        schema: LEARN_SKILL_TOOL_SPEC.inputSchema
      }
    )

    const updatePlan = tool(
      async () => ({ message: 'update_plan handled by hand node' }),
      {
        name: UPDATE_PLAN_TOOL_SPEC.name,
        description: UPDATE_PLAN_TOOL_SPEC.promptSpec.description,
        schema: UPDATE_PLAN_TOOL_SPEC.inputSchema
      }
    )

    const finish = tool(
      async () => ({ message: 'finish handled by mouth node' }),
      {
        name: FINISH_TOOL_SPEC.name,
        description: FINISH_TOOL_SPEC.promptSpec.description,
        schema: FINISH_TOOL_SPEC.inputSchema
      }
    )

    return [learnSkill, updatePlan, finish]
  }
}
