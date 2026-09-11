import { tool } from '@langchain/core/tools'
import type { ToolFamilyDefinition } from '../types'
import { LEARN_SKILL_TOOL_SPEC, READ_IMAGE_TOOL_SPEC, UPDATE_PLAN_TOOL_SPEC } from './toolSpecs'
import { prepareImagesForMainModel } from './readImage'

// agent-control 工具只用于让模型通过原生 tool call 表达控制意图（学习技能、更新计划），
// 真正的副作用由对应节点（learning / plan）按工具名拦截处理，因此这里的 func 只是兜底占位。
export const agentControlToolFamily: ToolFamilyDefinition = {
  familyId: 'agent-control',
  buildTools: ({ ctx }) => {
    const learnSkill = tool(async () => ({}), {
      name: LEARN_SKILL_TOOL_SPEC.name,
      description: LEARN_SKILL_TOOL_SPEC.promptSpec.description,
      schema: LEARN_SKILL_TOOL_SPEC.inputSchema
    })

    const updatePlan = tool(async () => ({}), {
      name: UPDATE_PLAN_TOOL_SPEC.name,
      description: UPDATE_PLAN_TOOL_SPEC.promptSpec.description,
      schema: UPDATE_PLAN_TOOL_SPEC.inputSchema
    })

    const readImage = tool(
      async (args) => {
        const images = await prepareImagesForMainModel({
          partnerId: ctx.partnerId,
          paths: args.paths
        })
        return { images }
      },
      {
        name: READ_IMAGE_TOOL_SPEC.name,
        description: READ_IMAGE_TOOL_SPEC.promptSpec.description,
        schema: READ_IMAGE_TOOL_SPEC.inputSchema
      }
    )

    return [learnSkill, updatePlan, readImage]
  }
}
