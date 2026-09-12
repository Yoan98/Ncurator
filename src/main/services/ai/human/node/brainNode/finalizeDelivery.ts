import type { AiRunContext } from '../../../types'
import type { HumanRuntimeCache, HumanState } from '../../types'
import type { MarkdownLinkAccessEntry } from '../../../../../../shared/types'
import {
  appendDocxApplyArtifactsAndEmitEvents,
  appendFileChangeArtifactsAndEmitEvents,
  buildFileChangesSummaryFromFileChangeRecords,
  mergeArtifactRefs
} from '../../../utils/artifacts'
import { emitFinalizingStarted } from '../../../events/processEvents'
import { renderHumanFileChangeLines } from '../../shared/runtimeRenderers'
import { resolveDeliveryLinkAccess } from '../../shared/referenceAccessMarkdown'
import { completeHumanTask } from '../utils/stateTransitions'

export const buildContentSafetyFallbackMarkdown = (state: HumanState): string =>
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

export const applyDeliverySideEffects = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
}): Promise<HumanState> => {
  const docxApplyRecords = await input.ctx.applyDocxRunEdits()
  const pptApplyRecords = (await input.cache.pptRuntime?.commitAll()) || []
  const fileChangeRecords = await input.ctx.listFileChangeRecords({ runId: input.ctx.runId })
  const fileChanges = buildFileChangesSummaryFromFileChangeRecords(fileChangeRecords)

  await input.ctx.appendMessageLog([
    { kind: 'annotation', eventType: 'finalizing_started', payload: {} }
  ])

  const docxArtifacts =
    docxApplyRecords.length > 0
      ? appendDocxApplyArtifactsAndEmitEvents({
          existingArtifacts: input.state.execution.artifacts,
          records: docxApplyRecords,
          sendEvent: input.ctx.sendEvent,
          runId: input.ctx.runId,
          taskId: input.state.task.taskId
        })
      : mergeArtifactRefs(input.state.execution.artifacts)
  const artifacts =
    pptApplyRecords.length > 0
      ? appendFileChangeArtifactsAndEmitEvents({
          existingArtifacts: docxArtifacts,
          records: pptApplyRecords,
          sendEvent: input.ctx.sendEvent,
          runId: input.ctx.runId,
          taskId: input.state.task.taskId
        })
      : docxArtifacts

  return {
    ...input.state,
    execution: {
      ...input.state.execution,
      fileChanges,
      artifacts
    }
  }
}

export const completeDelivery = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  deliveryMarkdown: string
  emitAnswerEvents: boolean
  linkAccess?: MarkdownLinkAccessEntry[]
}): HumanState => {
  if (input.emitAnswerEvents) {
    emitFinalizingStarted({
      sendEvent: input.ctx.sendEvent,
      runId: input.ctx.runId
    })
  }
  return completeHumanTask({
    ctx: input.ctx,
    cache: input.cache,
    state: input.state,
    deliveryMarkdown: input.deliveryMarkdown,
    emitAnswerEvents: input.emitAnswerEvents,
    linkAccess: input.linkAccess
  })
}

export const finalizeDelivery = async (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  deliveryMarkdown: string
  emitAnswerEvents: boolean
}): Promise<HumanState> => {
  const readyState = await applyDeliverySideEffects({
    ctx: input.ctx,
    cache: input.cache,
    state: input.state
  })
  const linkAccess = await resolveDeliveryLinkAccess(input.deliveryMarkdown)
  await input.ctx.appendMessageLog([
    {
      kind: 'assistant',
      content: input.deliveryMarkdown,
      toolCalls: [],
      linkAccess
    }
  ])
  return completeDelivery({
    ctx: input.ctx,
    cache: input.cache,
    state: readyState,
    deliveryMarkdown: input.deliveryMarkdown,
    emitAnswerEvents: input.emitAnswerEvents,
    linkAccess
  })
}
