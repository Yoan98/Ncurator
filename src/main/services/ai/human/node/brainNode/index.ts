import type { AiRunContext } from '../../../types'
import { isLlmOutputError } from '../../../errors'
import { applyThoughtPatch } from '../../memory/thoughtMemory'
import { buildBrainPrompt } from '../../prompts/brain'
import { createHumanThoughtDecisionSchema } from '../../schema'
import { assertExternalLearnedSkillIds } from '../../skills'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { isContentSafetyError } from '../../../utils/runFailure'
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
    const history = await input.ctx.loadConversationContext()
    const thoughtDecisionSchema = createHumanThoughtDecisionSchema()
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
      const result = await input.ctx.chatStructured({
        caller: 'human.brain',
        taskId: state.task.taskId,
        ...buildBrainPrompt({
          state,
          ctx: input.ctx,
          conversationSummaryText: history.conversationSummaryText,
          recentTurnsText: history.recentTurnsText
        }),
        schema: thoughtDecisionSchema,
        schemaName: 'human_brain_decision',
        temperature: 0.1,
        streamingMode: 'force_non_stream',
        contextBudgetSnapshot: state.execution.contextBudget
      })
      const inputTokens = result.usage?.inputTokens
      if (inputTokens !== undefined) {
        input.cache.lastBrainInputTokens = inputTokens
        input.cache.lastBrainRoundCount = state.memory.taskRun.rounds.length
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
      const parsedThought = thoughtDecisionSchema.parse(result.output)
      const thoughtMemory = applyThoughtPatch({
        memory: state.memory.thought,
        thought: parsedThought.thought
      })

      completeThinking()
      return applyBrainDecisionTransition({
        ctx: input.ctx,
        cache: input.cache,
        state,
        thought: parsedThought,
        thoughtMemory,
        overrides: {}
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
            currentThought: {
              thought: {
                next: '由于服务端内容安全策略限制，本轮直接进入最终收尾。'
              },
              nextAction: { action: 'mouth' }
            },
            deliveryGuidanceItems: mergeDeliveryGuidanceItems(
              state.execution.deliveryGuidanceItems,
              guidance
            ),
            pendingFault: undefined,
            pendingDecisionHint: {
              code: 'brain_content_safety',
              detail: { message: guidance?.text || '内容安全策略限制' }
            }
          }
        }
      }
      if (!isLlmOutputError(error)) {
        failThinking(error)
        throw error
      }

      completeThinking()
      const issues = error.issues || [{ path: 'output', message: error.message }]
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'fault',
          pendingFault: {
            result: '决策失败，输出无法解析为可路由的决策结构。',
            issues
          },
          pendingDecisionHint: undefined
        }
      }
    }
  }
}
