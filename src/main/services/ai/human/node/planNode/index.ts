import { SystemMessage } from '@langchain/core/messages'
import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import type { HumanPlanItem, HumanRuntimeCache, HumanState } from '../../types'
import { normalizePlanItems } from '../../memory/thoughtMemory'
import { renderPlanItems } from '../../shared/memoryRenderers'
import { emitToolCallResult, emitToolCallStarted } from '../../tools/utils/toolEvents'
import { UPDATE_PLAN_SCHEMA } from '../../tools/agentControl/toolSpecs'
import { appendToolFeedback } from '../../shared/toolFeedback'
import { returnToDispatch } from '../utils/stateTransitions'

const parsePlanArgs = (
  args: JsonObject
): { ok: true; plan: HumanPlanItem[] } | { ok: false; message: string } => {
  const parsed = UPDATE_PLAN_SCHEMA.safeParse(args)
  if (!parsed.success) {
    const detail = parsed.error.issues.map((issue) => issue.message).join('；')
    return { ok: false, message: `update_plan 参数不合法：${detail}` }
  }
  return { ok: true, plan: normalizePlanItems(parsed.data.plan) }
}

export const createPlanNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    input.cache.currentState = state

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'plan') {
      return returnToDispatch(state)
    }

    const calls = pendingRound.nextAction.calls

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

    let nextPlan = state.memory.plan
    for (const call of calls) {
      const parsed = parsePlanArgs(call.args)
      if (!parsed.ok) {
        emitToolCallResult({
          ctx: input.ctx,
          runId: input.ctx.runId,
          taskId: state.task.taskId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          error: parsed.message,
          stage: 'human_plan'
        })
        await appendToolFeedback({
          cache: input.cache,
          ctx: input.ctx,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          ok: false,
          errorMessage:
            'Invalid update_plan arguments. Fix the plan item fields or statuses and try again.'
        })
        continue
      }

      nextPlan = parsed.plan
      emitToolCallResult({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        result: {
          toolName: call.toolName,
          ok: true,
          data: { message: '计划已更新', plan: parsed.plan }
        },
        stage: 'human_plan'
      })
      await appendToolFeedback({
        cache: input.cache,
        ctx: input.ctx,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        ok: true,
        content: 'Plan updated successfully.'
      })
    }

    if (nextPlan.length > 0) {
      const messages = input.cache.messages || []
      messages.push(
        new SystemMessage(`<runtime_state>
  <current_plan>
${renderPlanItems(nextPlan)}
  </current_plan>
</runtime_state>`)
      )
      input.cache.messages = messages
    }

    return returnToDispatch(state, {
      memory: {
        ...state.memory,
        plan: nextPlan
      }
    })
  }
}
