import type { HumanOutcome, HumanReasoningOutput, HumanRuntimeCache, HumanState } from '../../types'
import type { AiRunContext } from '../../../types'
import { emitHumanStep } from '../shared/events'
import { getActiveToolNames } from '../shared/runtime'
import { createWatchdogSidecar } from '../shared/watchdog'
import { buildReasonPromptContext } from './context'
import { parseReasonOutput } from './contract'
import { applyReasonResultToState, appendTerminalOutcomeToState, mergeMemory } from './stateOps'
import type { AiRunContextWithReasonOverride } from './types'

const toJsonText = (value: object | undefined, fallback = 'none'): string => {
  if (!value) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

export const createHumanReasonNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  watchdog: ReturnType<typeof createWatchdogSidecar>
}) => {
  const ctxWithOverride = input.ctx as AiRunContextWithReasonOverride

  return async (state: HumanState): Promise<Partial<HumanState>> => {
    input.ctx.checkCancelled()

    const watchdogReview = await input.watchdog.review(state)
    const latestObservation = state.turn.incoming?.observations.at(-1)
    if (
      latestObservation &&
      latestObservation.kind === 'tool_result' &&
      (latestObservation.code === 'workspace_required' || latestObservation.code === 'approval_denied')
    ) {
      const nextTurn = {
        incoming: state.turn.incoming,
        analysis: {
          summary: latestObservation.summary
        },
        actionBatch: undefined,
        watchdogHint: watchdogReview.hint
      }
      const outcome: HumanOutcome = {
        status: 'blocked',
        summary: latestObservation.summary
      }
      const finalizedState = appendTerminalOutcomeToState({
        state,
        nextMemory: state.memory,
        nextTurn,
        outcome
      })
      emitHumanStep({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        stepIndex: finalizedState.trace.steps.at(-1)?.step || state.trace.steps.length + 1,
        action: 'block_task',
        publicNarrative: '当前任务无法继续可靠推进，因此在此阻塞。',
        activeSkillIds: state.memory.capabilityFocus.activeStack,
        activeToolNames: getActiveToolNames({
          state: finalizedState,
          cache: input.cache
        }),
        summary: outcome.summary,
        resultStatus: 'blocked',
        stage: 'human_reason'
      })
      input.watchdog.commitReason(finalizedState)
      return finalizedState
    }

    const prompt = buildReasonPromptContext({
      ctx: input.ctx,
      cache: input.cache,
      state,
      watchdogHintText: toJsonText(watchdogReview.hint)
    })

    const overridden = ctxWithOverride.resolveHumanReasonOverride?.()
    let rawOutput: HumanReasoningOutput
    if (overridden) {
      rawOutput = overridden
    } else {
      try {
        rawOutput = await input.ctx.chatJson<HumanReasoningOutput>({
          system: prompt.system,
          user: prompt.user,
          temperature: 0.1
        })
      } catch (error) {
        if (watchdogReview.mustConverge) {
          void error
          rawOutput = {
            memoryPatch: {},
            analysis: {
              summary: 'watchdog 触发最终收敛，但当前没有可用模型推理能力。'
            },
            outcome: input.watchdog.synthesizeBlocked(
              state,
              'watchdog 判断当前任务已无法继续安全推进，因此直接阻塞。'
            )
          }
        } else {
          throw error
        }
      }
    }

    const normalizedOutput = parseReasonOutput({
      rawOutput,
      state
    })
    const nextMemory = mergeMemory(state.memory, normalizedOutput.memoryPatch || {})
    const nextTurn: HumanState['turn'] = {
      incoming: state.turn.incoming,
      analysis: {
        summary: normalizedOutput.analysis.summary
      },
      actionBatch: normalizedOutput.actionBatch,
      watchdogHint: watchdogReview.hint
    }

    const mustConverge = watchdogReview.mustConverge || input.watchdog.wasHardRequested()
    let nextOutcome = normalizedOutput.outcome
    if (mustConverge && !nextOutcome) {
      nextOutcome = input.watchdog.synthesizeBlocked(
        state,
        'watchdog 判断当前任务继续推进只会增加空转风险，因此本轮收敛为 blocked。'
      )
      nextTurn.actionBatch = undefined
    }

    const nextState = applyReasonResultToState({
      state,
      nextMemory,
      nextTurn,
      outcome: nextOutcome
    })

    if (nextOutcome) {
      const finalizedState = nextState
      emitHumanStep({
        ctx: input.ctx,
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        stepIndex: finalizedState.trace.steps.at(-1)?.step || state.trace.steps.length + 1,
        action: nextOutcome.status === 'completed' ? 'complete_task' : 'block_task',
        publicNarrative:
          nextOutcome.status === 'completed'
            ? '我已经具备完成当前任务的充分依据。'
            : '当前任务无法继续可靠推进，因此在此阻塞。',
        activeSkillIds: nextMemory.capabilityFocus.activeStack,
        activeToolNames: getActiveToolNames({
          state: finalizedState,
          cache: input.cache
        }),
        summary: nextOutcome.summary,
        resultStatus: nextOutcome.status === 'completed' ? 'ok' : 'blocked',
        stage: 'human_reason'
      })
      input.watchdog.commitReason(finalizedState)
      return finalizedState
    }

    input.watchdog.commitReason(nextState)
    return nextState
  }
}
