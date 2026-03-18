import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type {
  AiTaskResultCode,
  HumanStepRecord,
  JsonObject,
  LocalSourceUsageStatus
} from '../../../../../shared/types'
import { createChatModel } from '../../../llm/chatModel'
import { buildHumanResponsePrompt } from '../../prompts/human/response'
import type { AiRunContext } from '../../types'
import { emitHumanDiagnostic, emitTaskDelivery } from './events'
import type { HumanRunState } from './types'

const MAX_HISTORY_ITEMS = 12

const normalizeText = (value: string, fallback = '无'): string => {
  const text = String(value || '').trim()
  return text || fallback
}

const toJsonText = (value: object | undefined, fallback = '无'): string => {
  if (!value) return fallback
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const renderStepHistory = (stepHistory: HumanStepRecord[]): string => {
  if (stepHistory.length === 0) return '无'
  return stepHistory
    .slice(-MAX_HISTORY_ITEMS)
    .map((step) =>
      [
        `step=${step.step}`,
        `action=${step.action}`,
        `narrative=${normalizeText(step.publicNarrative, '无')}`,
        `summary=${normalizeText(step.summary || '', '无')}`
      ].join(' | ')
    )
    .join('\n')
}

const renderLastObservation = (state: HumanRunState): string => {
  if (!state.lastObservation) return '无'
  try {
    return JSON.stringify(state.lastObservation, null, 2)
  } catch {
    return normalizeText(state.lastObservation.summary, '无')
  }
}

const buildFallbackDeliveryMarkdown = (state: HumanRunState): string => {
  if (state.deliveryKind === 'final') {
    return [
      '# 最终答复',
      '',
      '## 结论',
      normalizeText(state.summary, '当前没有可确认的最终结论。'),
      '',
      '## 已完成内容',
      normalizeText(state.summary, '无'),
      '',
      '## 关键依据',
      normalizeText(state.lastObservation?.summary || '', '待确认'),
      '',
      '## 未完成或待确认',
      state.status === 'blocked' ? normalizeText(state.summary, '待确认') : '无',
      '',
      '## 下一步建议',
      state.status === 'blocked' ? '请根据上面的阻塞说明补充条件后重试。' : '如需继续扩展，可基于以上结论追加要求。'
    ].join('\n')
  }

  return [
    '# 子任务交付',
    '',
    '## 已完成',
    normalizeText(state.summary, '无'),
    '',
    '## 关键发现',
    normalizeText(state.lastObservation?.summary || '', '待确认'),
    '',
    '## 证据与来源',
    '请结合 step history 和 tool 结果继续回放；本次自动回退交付未能展开更多证据。',
    '',
    '## 风险与未决',
    state.status === 'blocked' ? normalizeText(state.summary, '待确认') : '无',
    '',
    '## 建议后续步骤',
    state.status === 'blocked' ? '优先解决当前阻塞项后再继续执行。' : '后续任务可基于本交付继续推进。'
  ].join('\n')
}

const deriveLocalSourceStatus = (state: HumanRunState): {
  status: LocalSourceUsageStatus
  summary: string
} => {
  const joined = [state.summary, state.deliveryMarkdown].join('\n')
  const insufficientMarkers = [
    '本地资料不足',
    '本地证据不足',
    '当前本地资料不足',
    '当前本地证据不足',
    '本地范围不足'
  ]
  const mentionsInsufficient = insufficientMarkers.some((marker) => joined.includes(marker))
  if (mentionsInsufficient) {
    return {
      status: 'insufficient',
      summary: '当前交付已明确说明本地资料不足，并请求是否允许继续使用非本地信息。'
    }
  }

  const usedLocalTools = state.stepHistory.some((step) => step.action === 'invoke_tool')
  if (usedLocalTools) {
    return {
      status: 'used',
      summary: '本轮通过本地能力执行形成了正式交付。'
    }
  }

  return {
    status: 'not_used',
    summary: '本轮未形成可确认的本地资料使用结果。'
  }
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

const invokeDeliveryModel = async (input: {
  ctx: AiRunContext
  state: HumanRunState
  streamAnswer: boolean
}): Promise<string> => {
  const prompt = buildHumanResponsePrompt({
    objective: input.state.input.objective,
    deliveryKind: input.state.deliveryKind,
    selectedScopeSummary: input.ctx.selectedScopeSummary,
    allowNonLocal: input.ctx.allowNonLocal,
    summary: input.state.summary,
    resultCode: input.state.resultCode,
    resultDataText: toJsonText(input.state.resultData),
    lastObservationText: renderLastObservation(input.state),
    stepHistoryText: renderStepHistory(input.state.stepHistory)
  })
  const cfg = await input.ctx.getModelConfig()
  const model = createChatModel(cfg, { temperature: 0.2 })

  if (!input.streamAnswer) {
    const response = await model.invoke([
      new SystemMessage(prompt.system),
      new HumanMessage(prompt.user)
    ])
    return normalizeText(resolveMessageText(response.content), '')
  }

  const stream = await model.stream([new SystemMessage(prompt.system), new HumanMessage(prompt.user)])
  let text = ''

  for await (const chunk of stream) {
    input.ctx.checkCancelled()
    const token = resolveMessageText(chunk.content)
    if (!token) continue
    text += token
    input.ctx.sendEvent({
      type: 'answer_token',
      runId: input.state.runId,
      taskId: input.state.input.taskId,
      token,
      stage: 'human_response'
    })
  }

  return normalizeText(text, '')
}

type AiRunContextWithHumanDeliveryOverride = AiRunContext & {
  resolveHumanDeliveryOverride?: (input: {
    objective: string
    summary: string
    resultCode: AiTaskResultCode
    resultData?: JsonObject
  }) => string
}

export const createHumanResponseNode = (input: { ctx: AiRunContext }) => {
  const { ctx } = input
  const ctxWithDeliveryOverride = ctx as AiRunContextWithHumanDeliveryOverride

  return async (state: HumanRunState): Promise<Partial<HumanRunState>> => {
    if (state.phase !== 'response') {
      return {}
    }

    ctx.checkCancelled()

    let deliveryMarkdown = ''

    try {
      const overriddenDelivery = ctxWithDeliveryOverride.resolveHumanDeliveryOverride?.({
        objective: state.input.objective,
        summary: state.summary,
        resultCode: state.resultCode,
        resultData: state.resultData
      })
      deliveryMarkdown =
        overriddenDelivery ||
        (await invokeDeliveryModel({
          ctx,
          state,
          streamAnswer: state.streamAnswer
        }))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'human response generation failed'
      emitHumanDiagnostic({
        ctx,
        runId: state.runId,
        taskId: state.input.taskId,
        stepIndex: state.steps,
        action: state.status === 'blocked' ? 'block_task' : 'complete_task',
        trace: {
          rationale: message,
          observationSummary: state.lastObservation?.summary
        },
        stage: 'human_response'
      })
    }

    const finalDelivery = normalizeText(deliveryMarkdown, buildFallbackDeliveryMarkdown(state))
    const localSource = deriveLocalSourceStatus({
      ...state,
      deliveryMarkdown: finalDelivery
    })

    if (state.streamAnswer) {
      ctx.sendEvent({
        type: 'answer_completed',
        runId: state.runId,
        taskId: state.input.taskId,
        text: finalDelivery,
        stage: 'human_response'
      })
    }

    emitTaskDelivery({
      ctx,
      runId: state.runId,
      taskId: state.input.taskId,
      summary: state.summary,
      deliveryMarkdown: finalDelivery,
      internal: state.internalDelivery
    })

    return {
      deliveryMarkdown: finalDelivery,
      localSourceStatus: localSource.status,
      localSourceSummary: localSource.summary
    }
  }
}
