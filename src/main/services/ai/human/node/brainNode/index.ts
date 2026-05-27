import { ZodError } from 'zod/v4'
import type { AiRunContext } from '../../../types'
import { HUMAN_BRAIN_SCHEMA_RETRY_LIMIT } from '../../constants'
import { applyThoughtPatch } from '../../memory/thoughtMemory'
import { buildBrainPrompt } from '../../prompts/brain'
import { createHumanThoughtDecisionSchema } from '../../schema'
import { assertExternalLearnedSkillIds } from '../../skills'
import { formatToolCallSchemaDiagnostic } from '../../toolCallSchema'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyBrainDecisionTransition, returnToBrainWithDecisionHint } from '../utils/stateTransitions'
import { getAvailableToolNames } from '../utils/runtimeCache'

export const createBrainNode = (input: { ctx: AiRunContext; cache: HumanRuntimeCache }) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state
    const history = await input.ctx.loadConversationContext()
    const availableToolNames = getAvailableToolNames({
      learnedSkillIds: state.skills.learnedSkillIds
    })
    const thoughtDecisionSchema = createHumanThoughtDecisionSchema(availableToolNames)

    try {
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

      return applyBrainDecisionTransition({
        ctx: input.ctx,
        cache: input.cache,
        state,
        thought: parsedThought,
        thoughtMemory,
        overrides: {
          execution: {
            brainSchemaRetryCount: 0
          }
        }
      })
    } catch (error) {
      if (!(error instanceof ZodError)) {
        throw error
      }

      const retryCount = state.execution.brainSchemaRetryCount || 0
      if (retryCount >= HUMAN_BRAIN_SCHEMA_RETRY_LIMIT) {
        throw error
      }

      const diagnostic = formatToolCallSchemaDiagnostic({
        error,
        pathPrefix: 'nextAction.calls'
      })

      return returnToBrainWithDecisionHint({
        ctx: input.ctx,
        state,
        source: 'brain',
        decisionHint: {
          code: 'brain_output_schema_invalid',
          detail: {
            issues: diagnostic.issues
          }
        },
        overrides: {
          execution: {
            brainSchemaRetryCount: retryCount + 1
          }
        }
      })
    }
  }
}
