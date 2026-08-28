import { tool } from '@langchain/core/tools'
import type { ToolFamilyDefinition } from '../types'
import { LEARN_SKILL_TOOL_SPEC, READ_IMAGE_TOOL_SPEC, UPDATE_PLAN_TOOL_SPEC } from './toolSpecs'
import { prepareImagesForMainModel } from './readImage'

// agent-control 工具只用于让模型通过原生 tool call 表达控制意图（学习技能、更新计划），
// 真正的副作用由对应节点（learning / plan）按工具名拦截处理，因此这里的 func 只是兜底占位。
export const agentControlToolFamily: ToolFamilyDefinition = {
  familyId: 'agent-control',
  buildTools: ({ ctx }) => {
    const learnSkill = tool(async () => ({ message: 'learn_skill handled by learning node' }), {
      name: LEARN_SKILL_TOOL_SPEC.name,
      description: LEARN_SKILL_TOOL_SPEC.promptSpec.description,
      schema: LEARN_SKILL_TOOL_SPEC.inputSchema
    })

    const updatePlan = tool(async () => ({ message: 'update_plan handled by plan node' }), {
      name: UPDATE_PLAN_TOOL_SPEC.name,
      description: UPDATE_PLAN_TOOL_SPEC.promptSpec.description,
      schema: UPDATE_PLAN_TOOL_SPEC.inputSchema
    })

    const readImage = tool(
      async (args) => {
        const workspaceRootPath = ctx.workspace?.rootPath
        if (!workspaceRootPath) throw new Error('read_image 需要绑定工作区')
        const images = await prepareImagesForMainModel({
          workspaceRootPath,
          paths: args.paths
        })
        return {
          message: `已按顺序读取 ${String(images.length)} 张图片，图片已加入当前主模型上下文。`,
          images
        }
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
