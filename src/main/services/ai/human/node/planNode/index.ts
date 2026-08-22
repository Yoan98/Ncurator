import { ToolMessage } from '@langchain/core/messages'
import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanPlanItem, HumanRuntimeCache, HumanState } from '../../types'
import { normalizePlanItems } from '../../memory/thoughtMemory'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'
import { advanceDispatchState } from '../dispatch'

const readPlanFromArgs = (args: JsonObject): HumanPlanItem[] => {
  const raw = Array.isArray(args.plan) ? args.plan : []
  return normalizePlanItems(
    raw
      .filter(
        (item): item is HumanPlanItem =>
          Boolean(item && typeof item === 'object' && !Array.isArray(item))
      )
      .map((item) => item as HumanPlanItem)
  )
}

export const createPlanNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'plan') {
      return advanceDispatchState(state)
    }

    const calls = pendingRound.nextAction.calls
    const messages = input.cache.messages || []

    for (const call of calls) {
      emitToolCallStarted({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolName: call.toolName,
        args: call.args,
        stage: 'human_plan',
        toolCallId: call.toolCallId
      })
    }

    const plansByCall = calls.map((call) => readPlanFromArgs(call.args))
    const nextPlan =
      plansByCall.length > 0 ? plansByCall[plansByCall.length - 1]! : state.memory.plan

    const planTranscript = calls.map((call, index) => ({
      kind: 'tool' as const,
      toolCallId: call.toolCallId || `plan-${index}`,
      toolName: call.toolName,
      result: { message: '计划已更新', plan: plansByCall[index] || [] }
    }))
    calls.forEach((call, index) => {
      const plan = plansByCall[index] || []
      emitToolCallResult({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolCallId: call.toolCallId || `plan-${index}`,
        toolName: call.toolName,
        result: {
          toolName: call.toolName,
          ok: true,
          data: { message: '计划已更新', plan }
        },
        stage: 'human_plan'
      })
      messages.push(
        new ToolMessage({
          content: JSON.stringify({ message: '计划已更新', plan }),
          tool_call_id: call.toolCallId || `plan-${index}`
        })
      )
    })
    input.cache.messages = messages
    await input.ctx.appendTranscript(planTranscript)

    return advanceDispatchState({
      ...state,
      memory: {
        ...state.memory,
        plan: nextPlan
      }
    })
  }
}
