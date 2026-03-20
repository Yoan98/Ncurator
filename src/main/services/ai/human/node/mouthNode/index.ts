import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { createChatModel } from '../../../../llm/chatModel'
import { parseJsonObject } from '../../../../../utils/aiCapabilityUtils'
import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendHumanTraceStep, emitHumanStep, emitTaskDelivery } from '../utils/events'
import { getAvailableToolNames } from '../learningNode/skillLoader'
import { buildMouthPromptContext } from './promptContext'
import type { AiRunContextWithMouthOverride } from './types'

const buildFallbackMarkdown = (state: HumanState, status: 'completed' | 'blocked', summary: string) =>
  [
    status === 'completed' ? '# 处理结果' : '# 当前阻塞说明',
    '',
    summary,
    '',
    '## 已确认事实',
    state.brainMemory.inside.facts.length > 0
      ? state.brainMemory.inside.facts.map((fact) => `- ${fact.summary}`).join('\n')
      : '无'
  ].join('\n')

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

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  streamAnswer: boolean
  internalDelivery: boolean
}) => {
  const ctxWithOverride = input.ctx as AiRunContextWithMouthOverride

  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()

    const finalStatus =
      state.lastBrainDecision?.nextAction.action === 'mouth' &&
      state.lastBrainDecision.nextAction.status === 'completed'
        ? 'completed'
        : 'blocked'
    const override = ctxWithOverride.resolveHumanDeliveryOverride?.({
      userInput: state.task.userInput,
      status: finalStatus,
      summary: state.lastBrainDecision?.decision.summary || '任务结束',
      state
    })

    let result = override
    if (!result) {
      const prompt = buildMouthPromptContext({
        state,
        finalStatus
      })
      try {
        const modelConfig = await input.ctx.getModelConfig()
        const model = createChatModel(modelConfig, { temperature: 0.2 })
        const response = await model.invoke([
          new SystemMessage(prompt.system),
          new HumanMessage(prompt.user)
        ])
        const parsed = parseJsonObject<{
          status: 'completed' | 'blocked'
          summary: string
          deliveryMarkdown: string
        }>(resolveMessageText(response.content))
        result = {
          status: parsed.status,
          summary: parsed.summary,
          deliveryMarkdown: parsed.deliveryMarkdown
        }
      } catch {
        result = {
          status: finalStatus,
          summary:
            state.lastBrainDecision?.decision.summary ||
            (finalStatus === 'completed' ? '任务已完成。' : '任务当前阻塞。'),
          deliveryMarkdown: buildFallbackMarkdown(
            state,
            finalStatus,
            state.lastBrainDecision?.decision.reason || '未获得稳定的对外交付。'
          )
        }
      }
    }

    const finalResult = {
      status: result.status,
      summary: result.summary,
      deliveryMarkdown:
        String(result.deliveryMarkdown || '').trim() ||
        buildFallbackMarkdown(state, result.status, result.summary)
    }
    if (input.streamAnswer) {
      input.ctx.sendEvent({
        type: 'answer_completed',
        runId: input.ctx.runId,
        taskId: state.task.taskId,
        text: finalResult.deliveryMarkdown,
        stage: 'human_mouth'
      })
    }
    emitTaskDelivery({
      ctx: input.ctx,
      taskId: state.task.taskId,
      summary: finalResult.summary,
      deliveryMarkdown: finalResult.deliveryMarkdown,
      internal: input.internalDelivery
    })
    const traceSteps = appendHumanTraceStep({
      steps: state.trace.steps,
      action: finalResult.status === 'completed' ? 'deliver_result' : 'block_result',
      publicNarrative: finalResult.summary,
      resultStatus: finalResult.status === 'completed' ? 'ok' : 'blocked',
      summary: finalResult.summary
    })
    const nextState: HumanState = {
      ...state,
      runtime: {
        stage: 'mouth',
        status: finalResult.status
      },
      result: finalResult,
      trace: {
        steps: traceSteps
      }
    }
    const step = nextState.trace.steps.at(-1)
    if (step) {
      emitHumanStep({
        ctx: input.ctx,
        taskId: state.task.taskId,
        step,
        learnedSkillIds: nextState.brainMemory.outside.learnedSkillIds,
        availableToolNames: getAvailableToolNames({
          learnedSkillIds: nextState.brainMemory.outside.learnedSkillIds,
          cache: input.cache
        }),
        stage: 'human_mouth'
      })
    }
    return nextState
  }
}
