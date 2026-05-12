import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { buildMouthPrompt } from '../../prompts/mouth'
import { assertExternalLearnedSkillIds } from '../../skills'
import { completeHumanTask } from '../utils/stateTransitions'
import {
  appendFileReviewArtifactsAndEmitEvents,
  buildRuntimeArtifactsSummaryFromFileReviewDetails,
  mergeArtifactRefs
} from '../../../utils/artifacts'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const fileReviewDetails = await input.ctx.finalizeDocxReviewRun()
    const runtimeArtifacts = buildRuntimeArtifactsSummaryFromFileReviewDetails(fileReviewDetails)
    let promptState: HumanState = {
      ...state,
      execution: {
        ...state.execution,
        runtimeArtifacts
      }
    }
    input.cache.currentState = promptState

    const prompt = buildMouthPrompt({ state: promptState, ctx: input.ctx })
    const rawDeliveryMarkdown = await input.ctx.chatText({
      caller: 'human.mouth',
      taskId: promptState.task.taskId,
      system: prompt.system,
      user: prompt.user,
      schemaName: 'human_mouth_markdown',
      temperature: 0.2,
      onTextDelta: input.emitAnswerEvents
        ? (text) => {
            input.ctx.sendEvent({
              type: 'answer_token',
              runId: input.ctx.runId,
              taskId: promptState.task.taskId,
              token: text,
              stage: 'human_mouth'
            })
          }
        : undefined
    })

    if (fileReviewDetails.length > 0) {
      input.ctx.checkCancelled()
      await input.ctx.persistDocxReviewRun(fileReviewDetails)
    }

    const artifacts =
      fileReviewDetails.length > 0
        ? appendFileReviewArtifactsAndEmitEvents({
            existingArtifacts: state.execution.artifacts,
            details: fileReviewDetails,
            sendEvent: input.ctx.sendEvent,
            runId: input.ctx.runId,
            taskId: state.task.taskId
          })
        : mergeArtifactRefs(state.execution.artifacts)
    const readyState: HumanState = {
      ...promptState,
      execution: {
        ...promptState.execution,
        artifacts
      }
    }
    input.cache.currentState = readyState

    const deliveryMarkdown =
      String(rawDeliveryMarkdown || '').trim() ||
      ['# 处理结果', '', promptState.execution.currentThought?.thought.summary || '任务结束'].join('\n')

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents
    })
  }
}
