import type { AiRunContext } from '../../../types'
import { HumanMessage, ToolMessage } from '@langchain/core/messages'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { buildMouthDeliveryMessage } from '../../prompts/mouth'
import { assertExternalLearnedSkillIds } from '../../skills'
import { completeHumanTask, returnToBrain } from '../utils/stateTransitions'
import {
  appendDocxApplyArtifactsAndEmitEvents,
  appendFileChangeArtifactsAndEmitEvents,
  buildFileChangesSummaryFromFileChangeRecords,
  mergeArtifactRefs
} from '../../../utils/artifacts'
import { emitFinalizingStarted } from '../../../events/processEvents'
import { resolveEvidenceReferenceAccess } from '../../shared/evidenceReferenceAccess'
import { brainEvidenceReferenceSchema } from '../../schema'
import { isContentSafetyError } from '../../../utils/runFailure'
import { renderHumanFileChangeLines } from '../../shared/runtimeRenderers'

const buildContentSafetyFallbackMarkdown = (state: HumanState): string =>
  [
    '# 处理结果',
    '',
    '本次处理受到服务端内容安全策略限制，无法生成完整的最终说明。',
    '已经成功保存的文件变更仍然有效，请调整输入内容或相关资料后重试。',
    '',
    '## 已保存的文件',
    renderHumanFileChangeLines(state, 'fallback_markdown'),
    '',
    '## 重试提示',
    ...(state.execution.deliveryGuidanceItems || []).map((item) => `- ${item.text}`)
  ].join('\n')

export const createMouthNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const pendingRound = state.execution.pendingRound
    if (!pendingRound || pendingRound.nextAction.action !== 'mouth') {
      throw new Error('决策失败，mouth 节点没有收到可读取的交付决策。')
    }

    const pendingItems = state.memory.plan
      .filter((item) => item.status === 'todo')
      .map((item) => item.title)
    if (pendingItems.length > 0 && state.execution.finalizationReason !== 'brain_content_safety') {
      const result = `交付失败，计划中仍有未完成事项：${pendingItems.join('、')}。`
      const finishToolCallId =
        pendingRound.nextAction.action === 'mouth' ? pendingRound.nextAction.toolCallId : undefined
      if (finishToolCallId) {
        const messages = input.cache.messages || []
        messages.push(
          new ToolMessage({
            content: result,
            tool_call_id: finishToolCallId
          })
        )
        input.cache.messages = messages
        await input.ctx.appendMessageLog([
          { kind: 'tool', toolCallId: finishToolCallId, toolName: 'finish', result: { message: result } }
        ])
      }
      return returnToBrain(state, {
        execution: {
          stage: 'context_budget',
          pendingDispatch: undefined
        },
        memory: {
          ...state.memory
        }
      })
    }

    const stateWithMouthRound: HumanState = {
      ...state,
      memory: {
        ...state.memory
      }
    }
    input.cache.currentState = stateWithMouthRound

    const docxApplyRecords = await input.ctx.applyDocxRunEdits()
    const pptApplyRecords = (await input.cache.pptRuntime?.commitAll()) || []
    const fileChangeRecords = await input.ctx.listFileChangeRecords({ runId: input.ctx.runId })
    const fileChanges = buildFileChangesSummaryFromFileChangeRecords(fileChangeRecords)
    const rawEvidenceReferences =
      stateWithMouthRound.execution.pendingRound?.nextAction.action === 'mouth'
        ? stateWithMouthRound.execution.pendingRound.nextAction.evidenceReferences
        : undefined
    const parsedEvidenceReferences = brainEvidenceReferenceSchema.array().safeParse(rawEvidenceReferences)
    const pendingEvidenceReferences = parsedEvidenceReferences.success
      ? parsedEvidenceReferences.data
      : undefined
    const evidenceReferences = await resolveEvidenceReferenceAccess({
      references: pendingEvidenceReferences
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

    const deliveryMessage = buildMouthDeliveryMessage({
      state: promptState,
      ctx: input.ctx
    })
    await input.ctx.appendMessageLog([
      { kind: 'annotation', eventType: 'finalizing_started', payload: {} }
    ])
    if (input.emitAnswerEvents) {
      emitFinalizingStarted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
    }

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

    const messages = [...(input.cache.messages || [])]
    messages.push(new HumanMessage(deliveryMessage))

    let rawDeliveryMarkdown: string
    try {
      rawDeliveryMarkdown = await input.ctx.chatMessages({
        caller: 'human.mouth',
        taskId: promptState.task.taskId,
        messages,
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
    } catch (error) {
      if (!isContentSafetyError(error)) throw error
      rawDeliveryMarkdown = buildContentSafetyFallbackMarkdown(readyState)
    }

    const deliveryMarkdown =
      String(rawDeliveryMarkdown || '').trim() ||
      [
        '# 处理结果',
        '',
        promptState.execution.pendingRound?.thought.text || '任务结束'
      ].join('\n')

    await input.ctx.appendMessageLog([
      { kind: 'assistant', content: deliveryMarkdown, toolCalls: [] }
    ])

    return completeHumanTask({
      ctx: input.ctx,
      cache: input.cache,
      state: readyState,
      deliveryMarkdown,
      emitAnswerEvents: input.emitAnswerEvents
    })
  }
}
