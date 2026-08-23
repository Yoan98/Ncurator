import { HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages'
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
      const repairedToolCalls: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> =
        []
      const unrecoverableCalls: Array<{ id?: string; name: string }> = []
      for (const invalidCall of invalidToolCalls) {
        const repaired = tryRepairJsonObject(invalidCall.args)
        if (repaired.ok) {
          repairedToolCalls.push({
            id: typeof invalidCall.id === 'string' ? invalidCall.id : undefined,
            name: typeof invalidCall.name === 'string' ? invalidCall.name : '',
            args: repaired.value
          })
        } else {
          unrecoverableCalls.push({
            id: typeof invalidCall.id === 'string' ? invalidCall.id : undefined,
            name: typeof invalidCall.name === 'string' ? invalidCall.name : ''
          })
        }
      }
      const allToolCalls = [...validToolCalls, ...repairedToolCalls]

      messages.push(assistantMessage)
      input.cache.messages = messages
      await input.ctx.appendMessageLog([
        {
          kind: 'assistant',
          content: extractTextContent(assistantMessage.content),
          toolCalls: [
            ...allToolCalls.map((call) => ({
              id: call.id || `call-${input.cache.toolCallCount}`,
              name: String(call.name || ''),
              args: (call.args || {}) as JsonObject
            })),
            ...unrecoverableCalls.map((call) => ({
              id: call.id || `invalid-${input.cache.toolCallCount}`,
              name: String(call.name || ''),
              args: {} as JsonObject
            }))
          ]
        }
      ])

      const thoughtText = extractTextContent(assistantMessage.content)
      const thought = normalizeRoundThought(thoughtText)

      if (unrecoverableCalls.length > 0) {
        for (const call of unrecoverableCalls) {
          const callId = call.id || `invalid-${input.cache.toolCallCount}`
          const toolName = call.name || ''
          messages.push(
            new ToolMessage({
              content: `工具 ${toolName || '未知'} 的调用参数不是合法 JSON，未执行。请重新生成该工具调用，确保参数是合法 JSON。`,
              tool_call_id: callId
            })
          )
          await input.ctx.appendMessageLog([
            {
              kind: 'tool',
              toolCallId: callId,
              toolName,
              result: { error: `工具 ${toolName} 调用参数不是合法 JSON，未执行。` }
            }
          ])
        }
        input.cache.messages = messages

        if (allToolCalls.length === 0) {
          completeThinking()
          await input.ctx.appendMessageLog([
            { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
          ])
          return returnToBrain(state)
        }
      }

      const dispatchQueue = buildDispatchQueue(allToolCalls)

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
