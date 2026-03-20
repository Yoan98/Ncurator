import type { HumanOutcome, HumanState, WatchdogHint } from '../../types'
import type { AiRunContext } from '../../../types'
import { emitWatchdogSignal } from './events'
import type { WatchdogSidecarState } from './types'

const buildActionBatchSignature = (state: HumanState): string => {
  const actionBatch = state.turn.actionBatch
  if (!actionBatch || actionBatch.actions.length === 0) return 'none'
  return actionBatch.actions
    .map((action) => {
      if (action.type === 'activate_capability') return `cap:${action.skillId}`
      return `tool:${action.toolName}:${JSON.stringify(action.args)}`
    })
    .join('|')
}

const summarizeSigns = (state: HumanState, memoryFactCount: number): string[] => {
  const signs: string[] = []
  if (state.trace.steps.length >= 6) signs.push('action_count_high')
  if (memoryFactCount === 0 && state.trace.steps.length >= 3) signs.push('no_facts_yet')
  return signs
}

const clipText = (value: string, maxChars = 300): string => {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

export const createWatchdogSidecar = (input: {
  ctx: AiRunContext
  taskId: string
  hardActionLimit: number
}) => {
  const runtime: WatchdogSidecarState = {
    startedAt: Date.now(),
    repeatedActionBatchCount: 0,
    stagnantCount: 0,
    focusChurnCount: 0,
    lastFactCount: 0,
    softWarnings: 0,
    hardRequested: false
  }

  const maybeRunModelWatchdog = async (state: HumanState): Promise<WatchdogHint | undefined> => {
    const mode = input.ctx.runtimeSettings.watchdogMode
    if (mode === 'off') return undefined

    const riskBoost = mode === 'aggressive' ? 1 : 0
    const enoughRisk =
      runtime.repeatedActionBatchCount >= 2 - riskBoost ||
      runtime.stagnantCount >= 2 - riskBoost ||
      runtime.focusChurnCount >= 2 - riskBoost
    if (!enoughRisk) return undefined

    let response: WatchdogHint
    try {
      response = await input.ctx.chatJson<WatchdogHint>({
        system: [
          '你是 human_reason 的监督者。',
          '请只输出 JSON，字段必须是 level、summary、signs、shouldConverge。',
          '如果任务仍可继续，level=warn；如果应强制本轮收敛，level=stop。'
        ].join('\n'),
        user: [
          `taskId=${input.taskId}`,
          `objective=${clipText(state.task.objective, 800)}`,
          `currentFocus=${state.memory.focus.current || 'none'}`,
          `openQuestions=${state.memory.openQuestions.join(' | ') || 'none'}`,
          `recentAnalysis=${state.turn.analysis?.summary || 'none'}`,
          `incoming=${state.turn.incoming?.summary || 'none'}`,
          `traceCount=${state.trace.steps.length}`,
          `signs=${summarizeSigns(state, state.memory.facts.length).join(',') || 'none'}`
        ].join('\n'),
        temperature: 0.1
      })
    } catch {
      return undefined
    }

    return {
      level: response.level === 'stop' ? 'stop' : 'warn',
      summary: clipText(response.summary, 240) || 'watchdog 建议尽快收敛',
      signs: response.signs.slice(0, 6),
      shouldConverge: Boolean(response.shouldConverge || response.level === 'stop')
    }
  }

  return {
    async review(state: HumanState): Promise<{ hint?: WatchdogHint; mustConverge: boolean }> {
      const factCount = state.memory.facts.length
      if (state.turn.incoming) {
        const incomingSummary = state.turn.incoming.summary
        runtime.stagnantCount =
          factCount > runtime.lastFactCount || incomingSummary !== runtime.lastIncomingSummary
            ? 0
            : runtime.stagnantCount + 1
        runtime.lastIncomingSummary = incomingSummary
      }
      runtime.lastFactCount = factCount

      const elapsedMs = Date.now() - runtime.startedAt
      const hardTriggered =
        state.trace.steps.length >= input.hardActionLimit ||
        elapsedMs >= 180_000 ||
        runtime.repeatedActionBatchCount >= 3 ||
        runtime.stagnantCount >= 4

      if (hardTriggered) {
        runtime.hardRequested = true
        const hint: WatchdogHint = {
          level: 'stop',
          summary: 'watchdog 认为当前任务已接近空转边界，本轮应直接收敛为 completed 或 blocked。',
          signs: summarizeSigns(state, factCount),
          shouldConverge: true
        }
        emitWatchdogSignal({
          ctx: input.ctx,
          runId: input.ctx.runId,
          taskId: input.taskId,
          level: hint.level,
          summary: hint.summary,
          signs: hint.signs
        })
        return { hint, mustConverge: true }
      }

      const hint = await maybeRunModelWatchdog(state)
      if (hint) {
        runtime.softWarnings += 1
        emitWatchdogSignal({
          ctx: input.ctx,
          runId: input.ctx.runId,
          taskId: input.taskId,
          level: hint.level,
          summary: hint.summary,
          signs: hint.signs
        })
        return { hint, mustConverge: hint.shouldConverge }
      }

      return { hint: undefined, mustConverge: false }
    },
    commitReason(state: HumanState): void {
      const signature = buildActionBatchSignature(state)
      if (signature !== 'none') {
        runtime.repeatedActionBatchCount =
          signature === runtime.lastActionBatchSignature ? runtime.repeatedActionBatchCount + 1 : 0
        runtime.lastActionBatchSignature = signature
      }

      const currentFocus = state.memory.focus.current
      if (currentFocus) {
        if (runtime.lastFocus && runtime.lastFocus !== currentFocus) {
          runtime.focusChurnCount += 1
        }
        runtime.lastFocus = currentFocus
      }
    },
    synthesizeBlocked(state: HumanState, summary: string): HumanOutcome {
      return {
        status: 'blocked',
        summary,
        payload: {
          watchdog_summary: summary,
          trace_count: state.trace.steps.length
        }
      }
    },
    wasHardRequested(): boolean {
      return runtime.hardRequested
    }
  }
}
