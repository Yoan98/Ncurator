import type { AIMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../llm/chatModel'
import { getToolCalls } from '../../../../utils/aiCapabilityUtils'
import type { AiSlotRef, JsonObject, JsonValue } from '../../../../../shared/types'
import type { AiRunContext } from '../../types'
import { buildCapabilityToolRegistry } from '../../tools/registry'
import { buildHumanControlTools } from './controlTools'
import type { HumanRunState } from './types'

const toSlotRefList = (value: JsonValue | undefined): AiSlotRef[] => {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.startsWith('slot:'))
    .map((item) => item as AiSlotRef)
}

const readObject = (value: JsonValue | undefined): JsonObject | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value
}

export const createHumanBrainNode = (input: {
  ctx: AiRunContext
}) => {
  const { ctx } = input

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    if (state.terminalState !== 'running') {
      return {
        phase: 'exit'
      }
    }

    // 回合上限是 human 的硬保护，防止脑循环在工具层面失控。
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
        terminalState: 'blocked',
        phase: 'exit',
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
    // 当前策略不做 tool 筛选：每步暴露全量 capability tools + control tools。
    const activeTools = [...capabilityRegistry.allTools, ...controlTools]

    const cfg = await ctx.getModelConfig()
    const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(activeTools)
    const ai = (await model.invoke(state.messages)) as AIMessage
    const toolCalls = getToolCalls(ai)
    const nextStep = state.steps + 1

    // strict tool-call only：无 tool call 视为无效输入并阻断任务。
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
        messages: [...state.messages, ai],
        steps: nextStep,
        terminalState: 'blocked',
        phase: 'exit',
        summary,
        resultCode: 'invalid_input'
      }
    }

    const first = toolCalls[0]
    const toolName = String(first.name || '').trim()
    const allowed = new Set(activeTools.map((toolItem) => String(toolItem.name || '')))
    // 模型幻觉到未注册 tool 时立即阻断，避免进入不确定执行分支。
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
        messages: [...state.messages, ai],
        steps: nextStep,
        terminalState: 'blocked',
        phase: 'exit',
        summary,
        resultCode: 'invalid_input'
      }
    }

    const args = readObject(first.args as JsonValue | undefined)
    const consume = toSlotRefList(args?.consume)
    const produce = toSlotRefList(args?.produce)
    const expect = toSlotRefList(readObject(args?.expect)?.requiredOutputs)

    return {
      activeTools,
      capabilityByTool: capabilityRegistry.toolToCapability,
      messages: [...state.messages, ai],
      lastAiMessage: ai,
      lastToolName: toolName,
      lastToolArgs: args || {},
      consume,
      produce,
      expect,
      steps: nextStep,
      phase: 'tool_exec'
    }
  }
}
