import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { appendDecisionRound, buildMouthExecution } from '../../memory/rounds'
import { buildMouthPrompt } from '../../prompts/mouth'
import { assertExternalLearnedSkillIds } from '../../skills'
import { completeHumanTask, returnToBrainWithDecisionHint } from '../utils/stateTransitions'
import {
  appendDocxApplyArtifactsAndEmitEvents,
  appendFileChangeArtifactsAndEmitEvents,
  buildFileChangesSummaryFromFileChangeRecords,
  mergeArtifactRefs
} from '../../../utils/artifacts'
import { emitFinalizingStarted } from '../../../events/processEvents'
import { resolveEvidenceReferenceAccess } from '../../shared/evidenceReferenceAccess'
import { brainEvidenceReferenceSchema } from '../../schema'

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    if (!state.execution.currentThought || state.execution.currentThought.nextAction.action !== 'mouth') {
      return {
        ...state,
        execution: {
          ...state.execution,
          stage: 'fault',
          pendingFault: { result: '决策失败，mouth 节点没有收到可读取的交付决策。' }
        }
      }
    }

    const pendingItems = (state.memory.thought.todolist || [])
      .filter((item) => item.status === 'todo')
      .map((item) => item.item)
    if (pendingItems.length > 0) {
      const decisionHint = {
        code: 'brain_todolist_incomplete' as const,
        detail: { pendingItems }
      }
      const result = `交付失败，todolist 中仍有未完成事项：${pendingItems.join('、')}。`
      return returnToBrainWithDecisionHint({
        ctx: input.ctx,
        state,
        source: 'brain',
        decisionHint,
        overrides: {
          memory: {
            ...state.memory,
            taskRun: appendDecisionRound({
              state,
              execution: buildMouthExecution({ result, decisionHint })
            })
          }
        }
      })
    }

    const stateWithMouthRound: HumanState = {
      ...state,
      memory: {
        ...state.memory,
        taskRun: appendDecisionRound({
          state,
          execution: buildMouthExecution({ result: '已完成最终交付。' })
        })
      }
    }
    input.cache.currentState = stateWithMouthRound

    const docxApplyRecords = await input.ctx.applyDocxRunEdits()
    const pptApplyRecords = (await input.cache.pptRuntime?.commitAll()) || []
    const fileChangeRecords = await input.ctx.listFileChangeRecords({ runId: input.ctx.runId })
    const fileChanges = buildFileChangesSummaryFromFileChangeRecords(fileChangeRecords)
    const history = await input.ctx.loadConversationContext()
    const rawEvidenceReferences =
      stateWithMouthRound.execution.currentThought?.nextAction.action === 'mouth'
        ? stateWithMouthRound.execution.currentThought.nextAction.evidenceReferences
        : undefined
    const parsedEvidenceReferences = brainEvidenceReferenceSchema.array().safeParse(rawEvidenceReferences)
    const pendingEvidenceReferences = parsedEvidenceReferences.success
      ? parsedEvidenceReferences.data
      : undefined
    const evidenceReferences = await resolveEvidenceReferenceAccess({
      references: pendingEvidenceReferences,
      workspaceRootPath: input.ctx.workspace?.rootPath
    })
    const promptState: HumanState = {
      ...stateWithMouthRound,
      execution: {
        ...stateWithMouthRound.execution,
        fileChanges,
        evidenceReferences
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

    const docxArtifacts =
      docxApplyRecords.length > 0
        ? appendDocxApplyArtifactsAndEmitEvents({
            existingArtifacts: stateWithMouthRound.execution.artifacts,
            records: docxApplyRecords,
            sendEvent: input.ctx.sendEvent,
            runId: input.ctx.runId,
            taskId: state.task.taskId
          })
        : mergeArtifactRefs(stateWithMouthRound.execution.artifacts)
    const artifacts =
      pptApplyRecords.length > 0
        ? appendFileChangeArtifactsAndEmitEvents({
            existingArtifacts: docxArtifacts,
            records: pptApplyRecords,
            sendEvent: input.ctx.sendEvent,
            runId: input.ctx.runId,
            taskId: state.task.taskId
          })
        : docxArtifacts
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
      ['# 处理结果', '', promptState.execution.currentThought?.thought.next || '任务结束'].join(
        '\n'
      )

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents
    })
  }
}
