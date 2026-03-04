import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../llm/chatModel'
import { getToolCalls } from '../../../../utils/aiCapabilityUtils'
import type { AiRunContext } from '../../types'
import { buildCapabilityToolRegistry } from '../../tools/registry'
import { buildHumanControlTools } from './controlTools'
import type { HumanRunState } from './types'

const buildBaseMessages = (state: HumanRunState) => {
  return [
    new SystemMessage(
      [
        '你是 human graph 的 brain。',
        '你每一步必须使用 tool call。',
        '可用工具包含 capability tools 与控制工具 complete_task/block_task。',
        '禁止直接输出自然语言结论，不允许无工具步骤。'
      ].join('\n')
    ),
    new HumanMessage(
      [
        `任务模式: ${state.input.mode}`,
        `任务目标: ${state.input.objective}`
      ].join('\n')
    )
  ]
}

export const createHumanBrainNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    if (state.status !== 'running') {
      return {}
    }

    if (state.steps >= state.maxSteps) {
      const summary = `human exceeded max steps (${state.maxSteps})`
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: 'block_task',
        summary,
        createdAt: Date.now(),
        stage: 'human_brain'
      })
      return {
        status: 'blocked',
        summary,
        resultCode: 'bounded_loop_error'
      }
    }

    const capabilityRegistry = buildCapabilityToolRegistry({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId
    })
    const controlTools = buildHumanControlTools({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId
    })
    const activeTools = [...capabilityRegistry.allTools, ...controlTools]

    const baseMessages = state.messages.length === 0 ? buildBaseMessages(state) : state.messages
    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(activeTools)
    const ai = (await model.invoke(baseMessages)) as AIMessage
    const toolCalls = getToolCalls(ai)
    const nextStep = state.steps + 1

    if (toolCalls.length === 0) {
      const summary = 'brain produced no tool call'
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: nextStep,
        action: 'block_task',
        summary,
        createdAt: Date.now(),
        stage: 'human_brain'
      })
      return {
        activeTools,
        messages: [...baseMessages, ai],
        steps: nextStep,
        status: 'blocked',
        summary,
        resultCode: 'invalid_input'
      }
    }

    const first = toolCalls[0]
    const toolName = String(first.name || '').trim()
    const allowed = new Set(activeTools.map((toolItem) => String(toolItem.name || '')))
    if (!allowed.has(toolName)) {
      const summary = `unknown tool call: ${toolName}`
      ctx.sendEvent({
        type: 'human_step',
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: nextStep,
        action: 'block_task',
        summary,
        createdAt: Date.now(),
        stage: 'human_brain'
      })
      return {
        activeTools,
        messages: [...baseMessages, ai],
        steps: nextStep,
        status: 'blocked',
        summary,
        resultCode: 'invalid_input'
      }
    }

    return {
      activeTools,
      messages: [...baseMessages, ai],
      lastAiMessage: ai,
      lastToolName: toolName,
      steps: nextStep,
      phase: 'tool_exec'
    }
  }
}
