import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { AiTaskResultCode, JsonObject } from '../../../../../../shared/types'
import { createChatModel } from '../../../../llm/chatModel'
import type { AiRunContext } from '../../../types'
import { buildHumanFinalizePrompt } from '../../../prompts/human/finalize'
import { emitTaskDelivery } from '../shared/events'
import { deriveProvenance } from './provenance'
import type { HumanState } from '../shared/state'

type AiRunContextWithFinalizeOverride = AiRunContext & {
  resolveHumanDeliveryOverride?: (input: {
    objective: string
    summary: string
    resultCode: AiTaskResultCode
    resultData?: JsonObject
  }) => string
}

const clipText = (value: string, maxChars = 160): string => {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

const toJsonText = (value: object | undefined, fallback = '无'): string => {
  if (!value) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const renderTrace = (state: HumanState): string => {
  if (state.trace.steps.length === 0) return '无'
  return state.trace.steps
    .slice(-10)
    .map((step) =>
      [
        `step=${step.step}`,
        `action=${step.action}`,
        `status=${step.resultStatus || 'none'}`,
        `summary=${clipText(step.summary)}`
      ].join(' | ')
    )
    .join('\n')
}

const buildFallbackMarkdown = (state: HumanState): string => {
  const heading = state.outcome?.status === 'completed' ? '# 最终交付' : '# 当前阻塞说明'
  return [
    heading,
    '',
    '## 摘要',
    state.outcome?.summary || '当前没有可确认的最终结论。',
    '',
    '## 当前焦点',
    state.memory.focus.current || '无',
    '',
    '## 已确认事实',
    state.memory.facts.length > 0
      ? state.memory.facts.map((fact) => `- ${fact.summary}`).join('\n')
      : '无',
    '',
    '## 下一步建议',
    state.outcome?.status === 'blocked'
      ? '请根据阻塞说明补充条件后重试。'
      : '如需继续扩展，可在当前结果上追加要求。'
  ].join('\n')
}

const resolveResultCode = (state: HumanState, forcedByWatchdog: boolean): AiTaskResultCode => {
  if (state.outcome?.status === 'completed') return 'ok'
  const lastObservation = state.turn.incoming?.observations.at(-1)
  if (lastObservation && lastObservation.kind === 'tool_result' && lastObservation.code !== 'ok') {
    return lastObservation.code
  }
  if (forcedByWatchdog) return 'bounded_loop_error'
  return 'failed'
}

const resolveMessageText = (content: string | object | Array<string | object>): string => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if ('text' in part && typeof part.text === 'string') return part.text
        return ''
      })
      .join('')
  }
  if ('text' in content && typeof content.text === 'string') return content.text
  return ''
}

export const createHumanFinalizeNode = (input: {
  ctx: AiRunContext
  streamAnswer: boolean
  internalDelivery: boolean
  wasForcedByWatchdog: () => boolean
}) => {
  const ctxWithOverride = input.ctx as AiRunContextWithFinalizeOverride

  return async (state: HumanState): Promise<Partial<HumanState>> => {
    input.ctx.checkCancelled()

    const outcome = state.outcome || {
      status: 'blocked' as const,
      summary: '任务未产出终态 outcome。'
    }
    const resultCode = resolveResultCode(state, input.wasForcedByWatchdog())
    let answerCompletedEmitted = false
    let deliveryMarkdown = ctxWithOverride.resolveHumanDeliveryOverride?.({
      objective: state.task.objective,
      summary: outcome.summary,
      resultCode,
      resultData: outcome.payload
    })

    if (!deliveryMarkdown) {
      const prompt = buildHumanFinalizePrompt({
        objective: state.task.objective,
        outcomeSummary: outcome.summary,
        outcomeStatus: outcome.status,
        payloadText: toJsonText(outcome.payload),
        memoryText: toJsonText(state.memory),
        traceText: renderTrace(state)
      })
      const config = await input.ctx.getModelConfig()
      const model = createChatModel(config, { temperature: 0.2 })

      if (!input.streamAnswer) {
        const response = await model.invoke([
          new SystemMessage(prompt.system),
          new HumanMessage(prompt.user)
        ])
        deliveryMarkdown = resolveMessageText(response.content)
      } else {
        const stream = await model.stream([new SystemMessage(prompt.system), new HumanMessage(prompt.user)])
        let text = ''
        for await (const chunk of stream) {
          input.ctx.checkCancelled()
          const token = resolveMessageText(chunk.content)
          if (!token) continue
          text += token
          input.ctx.sendEvent({
            type: 'answer_token',
            runId: input.ctx.runId,
            taskId: state.task.taskId,
            token,
            stage: 'human_finalize'
          })
        }
        input.ctx.sendEvent({
          type: 'answer_completed',
          runId: input.ctx.runId,
          taskId: state.task.taskId,
          text,
          stage: 'human_finalize'
        })
        answerCompletedEmitted = true
        deliveryMarkdown = text
      }
    }

    const finalMarkdown = String(deliveryMarkdown || '').trim() || buildFallbackMarkdown(state)
    const provenance = deriveProvenance(state, finalMarkdown)

    if (input.streamAnswer && !answerCompletedEmitted) {
      input.ctx.sendEvent({
        type: 'answer_completed',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        text: finalMarkdown,
        stage: 'human_finalize'
      })
    }

    emitTaskDelivery({
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      summary: outcome.summary,
      deliveryMarkdown: finalMarkdown,
      internal: input.internalDelivery
    })

    return {
      ...state,
      outcome: {
        ...outcome,
        presentation: {
          markdown: finalMarkdown
        },
        provenance
      }
    }
  }
}
