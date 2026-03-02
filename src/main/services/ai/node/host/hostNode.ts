import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../llm/chatModel'
import { getMessageText } from '../../../../utils/aiCapabilityUtils'
import type { CapabilityExecutor } from '../../../../utils/aiCapabilityUtils'
import type { AiHostAction, AiRunContext, AiRunState } from '../../types'
import { executeHostAction, pickNextTask } from './hostActionExecutor'
import {
  buildHostActionTools,
  parseHostActionFromFallbackText,
  parseHostActionFromToolMessage
} from './hostActionTools'
import { buildHostDecisionPrompt, buildHostFinalAnswer } from './hostPrompt'

const MAX_HOST_DECISION_ROUNDS = 12
const MAX_CONTEXT_ENRICHMENT_ROUNDS = 4
const MAX_HOST_LOOP_ELAPSED_MS = 2 * 60 * 1000
const MAX_CONTEXT_EVIDENCE_ITEMS = 24

const normalizeRounds = (value: number | undefined): number => {
  const n = Number(value || 0)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

const normalizeTimestamp = (value: number | undefined): number => {
  const n = Number(value || 0)
  return Number.isFinite(n) && n > 0 ? n : Date.now()
}

const appendEvidence = (items: string[], text: string): string[] => {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  if (!normalized) return items
  if (items.includes(normalized)) return items
  return [...items, normalized].slice(-MAX_CONTEXT_EVIDENCE_ITEMS)
}

const resolveHostAction = async (ctx: AiRunContext, state: AiRunState): Promise<AiHostAction> => {
  const history = await ctx.loadHistory()
  const { system, user } = buildHostDecisionPrompt({ state, history })
  const cfg = await ctx.getModelConfig()
  const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(buildHostActionTools())
  const ai = (await model.invoke([new SystemMessage(system), new HumanMessage(user)])) as AIMessage

  const fromTool = parseHostActionFromToolMessage(ai)
  if (fromTool) return fromTool

  const fromFallback = parseHostActionFromFallbackText(getMessageText(ai.content))
  if (fromFallback) return fromFallback

  return { action: 'final_answer' }
}

export const createHostNode = (input: {
  ctx: AiRunContext
  capabilityRegistry: Map<string, CapabilityExecutor>
}) => {
  const { ctx, capabilityRegistry } = input

  return async (state: AiRunState): Promise<Partial<AiRunState>> => {
    ctx.checkCancelled()

    const hostDecisionRounds = normalizeRounds(state.hostDecisionRounds)
    const contextEnrichmentRounds = normalizeRounds(state.contextEnrichmentRounds)
    const hostLoopStartedAt = normalizeTimestamp(state.hostLoopStartedAt)
    const contextEvidence = Array.isArray(state.contextEvidence) ? state.contextEvidence : []

    const normalizedState: AiRunState = {
      ...state,
      hostLoopStartedAt,
      hostDecisionRounds,
      contextEnrichmentRounds,
      contextEvidence
    }

    const plan = Array.isArray(normalizedState.plan) ? normalizedState.plan : []
    const failed = plan.find((task) => task.status === 'failed')
    if (failed) {
      return {
        plan,
        activeTaskId: undefined,
        status: 'failed',
        error: failed.error || normalizedState.error || 'failed'
      }
    }

    const next = pickNextTask(plan)
    if (next) {
      if (next.status === 'pending') {
        const updatedPlan = plan.map((task) =>
          task.id === next.id ? { ...task, status: 'running' as const } : task
        )
        ctx.sendEvent({
          type: 'task_started',
          runId: normalizedState.runId,
          taskId: next.id,
          stage: 'plan_execution'
        })
        return {
          plan: updatedPlan,
          activeTaskId: next.id,
          status: 'running'
        }
      }
      return {
        plan,
        activeTaskId: next.id,
        status: 'running'
      }
    }

    if (plan.length > 0) {
      const outputText = await buildHostFinalAnswer(ctx, normalizedState)
      return {
        plan,
        activeTaskId: undefined,
        status: 'completed',
        outputText
      }
    }

    const elapsedMs = Date.now() - hostLoopStartedAt
    if (elapsedMs >= MAX_HOST_LOOP_ELAPSED_MS) {
      const summary = `host decision loop timeout (${Math.floor(elapsedMs / 1000)}s)`
      const outputText = await buildHostFinalAnswer(ctx, {
        ...normalizedState,
        contextEvidence: appendEvidence(contextEvidence, summary)
      })
      return {
        plan: [],
        activeTaskId: undefined,
        status: 'completed',
        outputText,
        hostLoopStartedAt,
        hostDecisionRounds,
        contextEnrichmentRounds,
        contextEvidence: appendEvidence(contextEvidence, summary)
      }
    }

    if (hostDecisionRounds >= MAX_HOST_DECISION_ROUNDS) {
      const outputText = await buildHostFinalAnswer(ctx, normalizedState)
      return {
        plan: [],
        activeTaskId: undefined,
        status: 'completed',
        outputText,
        hostLoopStartedAt,
        hostDecisionRounds,
        contextEnrichmentRounds,
        contextEvidence
      }
    }

    let action = await resolveHostAction(ctx, normalizedState)
    if (
      action.action === 'retrieve_context' &&
      contextEnrichmentRounds >= MAX_CONTEXT_ENRICHMENT_ROUNDS
    ) {
      action = { action: 'final_answer' }
    }

    return executeHostAction({
      ctx,
      state: normalizedState,
      action,
      capabilityRegistry,
      buildFinalAnswer: () => buildHostFinalAnswer(ctx, normalizedState)
    })
  }
}
