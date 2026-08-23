import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { getToolCalls } from '../../../../../utils/aiCapabilityUtils'
import { extractTextContent, tryRepairJsonObject } from '../../../structuredOutput'
import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { isContentSafetyError } from '../../../utils/runFailure'
import { normalizeRoundThought } from '../../memory/thoughtMemory'
import { deriveMessageLogMessages } from '../../memory/transcript'
import { buildBrainSystemPrompt, buildBrainUserMessage } from '../../prompts/brain'
import { assertExternalLearnedSkillIds } from '../../skills'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyBrainDispatchTransition, returnToBrain } from '../utils/stateTransitions'
import { buildAvailableTools } from '../learningNode/skillLoader'
import { createDeliveryGuidanceItem, mergeDeliveryGuidanceItems } from '../../shared/deliveryGuidance'
import { buildDispatchQueue } from '../dispatch'
import { appendToolFeedback } from '../../shared/toolFeedback'
import {
  emitThinkingCompleted,
  emitThinkingFailed,
  emitThinkingStarted
} from '../../../events/processEvents'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    let messages = input.cache.messages
    if (!messages || messages.length === 0) {
      const injectPlan = state.memory.plan.length > 0
      const compactedHistoryText = state.memory.compactions.at(-1)?.summary
      const prefix = [
        new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
        new HumanMessage(
          buildBrainUserMessage({
            state,
            ctx: input.ctx,
            injectPlan,
            compactedHistoryText
          })
        )
      ]
      input.cache.prefixMessages = prefix
      const transcript = await input.ctx.loadMessageLog()
      messages = [
        ...prefix,
        ...deriveMessageLogMessages({
          entries: transcript,
          skipUserContent: state.task.userInput
        })
      ]
      input.cache.messages = messages
    }

    const tools = buildAvailableTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      learnedSkillIds: state.skills.learnedSkillIds
    })

    let thinkingOpen = false
    const completeThinking = (): void => {
      if (!thinkingOpen) return
      emitThinkingCompleted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
      thinkingOpen = false
    }
    const failThinking = (error: unknown): void => {
      if (!thinkingOpen) return
      emitThinkingFailed({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId,
        error: getErrorMessage(error)
      })
      thinkingOpen = false
    }

    try {
      emitThinkingStarted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
      thinkingOpen = true
      await input.ctx.appendMessageLog([
        { kind: 'annotation', eventType: 'thinking_started', payload: {} }
      ])

      const result = await input.ctx.chatTools({
        caller: 'human.brain',
        taskId: state.task.taskId,
        messages,
        tools,
        temperature: 0.1,
        contextBudgetSnapshot: state.execution.contextBudget
      })

      const inputTokens = result.usage?.inputTokens
      if (inputTokens !== undefined) {
        input.cache.lastBrainInputTokens = inputTokens
        input.cache.postCompactionNeedsFreshBrainUsage = false
        input.cache.lastBrainUsageUnavailable = false
      } else {
        input.cache.lastBrainUsageUnavailable = true
        input.ctx.sendEvent({
          type: 'runtime_issue',
          runId: input.ctx.runId,
          taskId: state.task.taskId,
          code: 'llm_usage_unavailable',
          message: '当前模型调用未返回 brain 输入 token usage，暂不基于真实 usage 触发上下文压缩。',
          createdAt: Date.now(),
          stage: 'human_brain'
        })
      }

      const assistantMessage = result.message
      const validToolCalls = getToolCalls(assistantMessage)
      const invalidToolCalls = Array.isArray(assistantMessage.invalid_tool_calls)
        ? assistantMessage.invalid_tool_calls
        : []
      const dispatchableCalls: Parameters<typeof buildDispatchQueue>[0] = []
      const unrecoverableCalls: Array<{ id?: string; name: string; errorMessage: string }> = []

      for (const call of validToolCalls) {
        const id = typeof call.id === 'string' && call.id.trim() ? call.id : undefined
        const name = typeof call.name === 'string' ? call.name : ''
        if (id) {
          dispatchableCalls.push({
            id,
            name,
            args: (call.args || {}) as Record<string, unknown>
          })
        } else {
          unrecoverableCalls.push({ name, errorMessage: '工具调用缺少 tool_call_id，未执行。' })
        }
      }
      for (const invalidCall of invalidToolCalls) {
        const repaired = tryRepairJsonObject(invalidCall.args)
        const id =
          typeof invalidCall.id === 'string' && invalidCall.id.trim() ? invalidCall.id : undefined
        const name = typeof invalidCall.name === 'string' ? invalidCall.name : ''
        if (repaired.ok && id) {
          dispatchableCalls.push({ id, name, args: repaired.value })
        } else {
          const detail =
            typeof invalidCall.error === 'string' ? ` 具体错误：${invalidCall.error}` : ''
          unrecoverableCalls.push({
            id,
            name,
            errorMessage: `工具 ${name || '未知'} 的调用参数不是合法 JSON，未执行。请重新生成该工具调用并修正 JSON 格式。${detail}`
          })
        }
      }

      messages.push(assistantMessage)
      input.cache.messages = messages
      await input.ctx.appendMessageLog([
        {
          kind: 'assistant',
          content: extractTextContent(assistantMessage.content),
          toolCalls: [
            ...dispatchableCalls.map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args as JsonObject
            })),
            ...unrecoverableCalls.map((call, index) => ({
              id: call.id || `invalid-${input.cache.toolCallCount}-${index}`,
              name: call.name,
              args: {} as JsonObject
            }))
          ]
        }
      ])

      const thoughtText = extractTextContent(assistantMessage.content)
      const thought = normalizeRoundThought(thoughtText)

      if (unrecoverableCalls.length > 0) {
        for (const [index, call] of unrecoverableCalls.entries()) {
          await appendToolFeedback({
            cache: input.cache,
            ctx: input.ctx,
            toolCallId: call.id || `invalid-${input.cache.toolCallCount}-${index}`,
            toolName: call.name || 'unknown',
            ok: false,
            errorCode: 'invalid_json',
            errorMessage: call.errorMessage
          })
        }

        if (dispatchableCalls.length === 0) {
          completeThinking()
          await input.ctx.appendMessageLog([
            { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
          ])
          return returnToBrain(state)
        }
      }

      const dispatchQueue = buildDispatchQueue(dispatchableCalls)

      completeThinking()
      await input.ctx.appendMessageLog([
        { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
      ])
      return applyBrainDispatchTransition({
        ctx: input.ctx,
        cache: input.cache,
        state,
        thought,
        dispatchQueue
      })
    } catch (error) {
      if (isContentSafetyError(error)) {
        completeThinking()
        const guidance = createDeliveryGuidanceItem(
          'brain',
          '本次处理受到服务端内容安全策略限制，无法继续执行。请调整输入内容或相关资料后重试。'
        )
        return {
          ...state,
          execution: {
            ...state.execution,
            stage: 'mouth',
            status: 'running',
            finalizationReason: 'brain_content_safety',
            pendingRound: {
              thought: { text: '由于服务端内容安全策略限制，本轮直接进入最终收尾。' },
              nextAction: { action: 'mouth' }
            },
            deliveryGuidanceItems: mergeDeliveryGuidanceItems(
              state.execution.deliveryGuidanceItems,
              guidance
            )
          }
        }
      }

      failThinking(error)
      throw error
    }
  }
}
