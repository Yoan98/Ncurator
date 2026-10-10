import { tool } from '@langchain/core/tools'
import type { ToolFamilyDefinition } from '../types'
import {
  DELEGATE_TO_SUBAGENT_TOOL_SPEC,
  LIST_AGENT_TOOL_SPEC,
  ASK_USER_QUESTION_TOOL_SPEC,
  LEARN_SKILL_TOOL_SPEC,
  READ_IMAGE_TOOL_SPEC,
  UPDATE_PLAN_TOOL_SPEC
} from './toolSpecs'
import { createToolEventEmitter } from '../utils/toolEvents'
import { withToolLifecycle } from '../utils/lifecycle'
import { prepareImagesForMainModel } from './readImage'

// 学习、计划和提问由各自节点处理；图片读取和子任务派发在公共 hand 工具链执行。
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

    const askUserQuestion = tool(async () => ({}), {
      name: ASK_USER_QUESTION_TOOL_SPEC.name,
      description: ASK_USER_QUESTION_TOOL_SPEC.promptSpec.description,
      schema: ASK_USER_QUESTION_TOOL_SPEC.inputSchema
    })

    const delegate = tool(
      async (args) =>
        await withToolLifecycle({
          emitter: createToolEventEmitter({ ctx, runId: ctx.runId, stage: 'human_hand' }),
          toolName: DELEGATE_TO_SUBAGENT_TOOL_SPEC.name,
          args,
          execute: async (session) => {
            const children = await ctx.delegateToSubagent(args.agents, session.toolCallId)
            const result = {
              toolName: DELEGATE_TO_SUBAGENT_TOOL_SPEC.name,
              ok: true,
              data: { children }
            }
            session.succeed(undefined, result)
            return { children }
          }
        }),
      {
        name: DELEGATE_TO_SUBAGENT_TOOL_SPEC.name,
        description: DELEGATE_TO_SUBAGENT_TOOL_SPEC.promptSpec.description,
        schema: DELEGATE_TO_SUBAGENT_TOOL_SPEC.inputSchema
      }
    )
    const list = tool(async () => ({ agents: ctx.listAgents() }), {
      name: LIST_AGENT_TOOL_SPEC.name,
      description: LIST_AGENT_TOOL_SPEC.promptSpec.description,
      schema: LIST_AGENT_TOOL_SPEC.inputSchema
    })
    return [list, learnSkill, updatePlan, readImage, askUserQuestion, delegate]
  }
}
