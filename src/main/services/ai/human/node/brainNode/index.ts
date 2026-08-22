import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { getToolCalls } from '../../../../../utils/aiCapabilityUtils'
import { extractTextContent } from '../../../structuredOutput'
import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { isContentSafetyError } from '../../../utils/runFailure'
import { normalizeRoundThought } from '../../memory/thoughtMemory'
import { deriveMessagesFromRounds } from '../../memory/messages'
import { buildBrainSystemPrompt, buildBrainUserMessage } from '../../prompts/brain'
import { renderDecisionHintForBrain } from '../../prompts/decisionHints'
import { assertExternalLearnedSkillIds } from '../../skills'
import { brainEvidenceReferenceSchema } from '../../schema'
import type { HumanNextAction, HumanRuntimeCache, HumanState } from '../../types'
import { applyBrainDecisionTransition } from '../utils/stateTransitions'
import { buildAvailableTools } from '../learningNode/skillLoader'
import { createDeliveryGuidanceItem, mergeDeliveryGuidanceItems } from '../../shared/deliveryGuidance'
import {
  emitThinkingCompleted,
  emitThinkingFailed,
  emitThinkingStarted
} from '../../../events/processEvents'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const readStringList = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []

const readFinishEvidenceReferences = (args: unknown) => {
  const raw =
    args && typeof args === 'object' ? (args as Record<string, unknown>).evidenceReferences : undefined
  const parsed = brainEvidenceReferenceSchema.array().optional().safeParse(raw)
  return parsed.success ? parsed.data : undefined
}

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const history = await input.ctx.loadConversationContext()

    let messages = input.cache.messages
    if (!messages || messages.length === 0) {
      const prefix = [
        new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
        new HumanMessage(
          buildBrainUserMessage({
            state,
            ctx: input.ctx,
            conversationSummaryText: history.conversationSummaryText,
            recentTurnsText: history.recentTurnsText
          })
        )
      ]
      input.cache.prefixMessages = prefix
      messages = [...prefix]
      if (state.memory.taskRun.rounds.length > 0) {
        messages.push(...deriveMessagesFromRounds(state.memory.taskRun.rounds))
      }
      input.cache.messages = messages
    }

    if (state.execution.pendingDecisionHint) {
      messages.push(
        new HumanMessage(
          `<decision_hint>\n${renderDecisionHintForBrain(state.execution.pendingDecisionHint)}\n</decision_hint>`
        )
      )
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

      const assistantMessage = result.message
      messages.push(assistantMessage)
      input.cache.messages = messages

      const thoughtText = extractTextContent(assistantMessage.content)
      const thought = normalizeRoundThought(thoughtText)
      const toolCalls = getToolCalls(assistantMessage)

      const finishCall = toolCalls.find((call) => call.name === 'finish')
      const learnSkillCall = toolCalls.find((call) => call.name === 'learn_skill')
      const finishEvidenceReferences = finishCall
        ? readFinishEvidenceReferences(finishCall.args)
        : undefined
      const learnSkillIds = learnSkillCall ? readStringList(learnSkillCall.args?.skillIds) : []

      let nextAction: HumanNextAction
      if (toolCalls.length === 0) {
        nextAction = { action: 'mouth' }
      } else if (finishCall) {
        nextAction = finishEvidenceReferences
          ? { action: 'mouth', evidenceReferences: finishEvidenceReferences, toolCallId: finishCall.id }
          : { action: 'mouth', toolCallId: finishCall.id }
      } else if (learnSkillCall) {
        nextAction =
          learnSkillIds.length > 0
            ? {
                action: 'learning',
                wantLearnSkillIds: learnSkillIds,
                toolCallId: learnSkillCall.id
              }
            : { action: 'mouth' }
      } else {
        nextAction = {
          action: 'hand',
          calls: toolCalls.map((call) => ({
            toolCallId: call.id,
            toolName: call.name,
            args: (call.args || {}) as JsonObject
          }))
        }
      }

      completeThinking()
      return applyBrainDecisionTransition({
        ctx: input.ctx,
        cache: input.cache,
        state,
        thought,
        nextAction
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
            ),
            pendingFault: undefined,
            pendingDecisionHint: {
              code: 'brain_content_safety',
              detail: { message: guidance?.text || '内容安全策略限制' }
            }
          }
        }
      }

      failThinking(error)
      throw error
    }
  }
}
