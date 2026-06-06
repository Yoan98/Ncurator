import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendDecisionRound, buildMouthExecution } from '../../memory/rounds'
import { buildMouthPrompt } from '../../prompts/mouth'
import { assertExternalLearnedSkillIds } from '../../skills'
import { completeHumanTask } from '../utils/stateTransitions'
import {
  appendDocxApplyArtifactsAndEmitEvents,
  buildRuntimeArtifactsSummaryFromDocxApplyRecords,
  mergeArtifactRefs
} from '../../../utils/artifacts'
import { emitFinalizingStarted } from '../../../events/processEvents'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const stateWithMouthRound: HumanState = {
      ...state,
      memory: {
        ...state.memory,
        taskRun: appendDecisionRound({
          state,
          execution: buildMouthExecution()
        })
      }
    }
    input.cache.currentState = stateWithMouthRound

    const docxApplyRecords = await input.ctx.applyDocxRunEdits()
    const runtimeArtifacts = buildRuntimeArtifactsSummaryFromDocxApplyRecords(docxApplyRecords)
    const history = await input.ctx.loadConversationContext()
    let promptState: HumanState = {
      ...stateWithMouthRound,
      execution: {
        ...stateWithMouthRound.execution,
        runtimeArtifacts
      }
    }
    input.cache.currentState = promptState

    const prompt = buildMouthPrompt({
      state: promptState,
      ctx: input.ctx,
      conversationSummaryText: history.conversationSummaryText,
      recentTurnsText: history.recentTurnsText
    })
    if (input.emitAnswerEvents) {
      emitFinalizingStarted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
    }

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

    const artifacts =
      docxApplyRecords.length > 0
        ? appendDocxApplyArtifactsAndEmitEvents({
            existingArtifacts: stateWithMouthRound.execution.artifacts,
            records: docxApplyRecords,
            sendEvent: input.ctx.sendEvent,
            runId: input.ctx.runId,
            taskId: state.task.taskId
          })
        : mergeArtifactRefs(stateWithMouthRound.execution.artifacts)
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
      ['# 处理结果', '', promptState.execution.currentThought?.thought.next || '任务结束'].join('\n')

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents
    })
  }
}
