import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { AiTaskResultCode, JsonObject } from '../../../../../../shared/types'
import { runBoundedLoop } from '../../../../../utils/boundedLoop'
import { createChatModel } from '../../../../llm/chatModel'
import { buildDocxCapabilityTools } from './docxTools'
import {
  CapabilityExecutor,
  completeTask,
  emitActivity,
  getMessageText,
  getToolCalls,
  getToolNodeMessages,
  markTaskFailed,
  resolveTaskObjective
} from '../../../../../utils/aiCapabilityUtils'

const MAX_DOCX_STEPS = 8
const DOCX_LOOP_TIMEOUT_MS = 90000
const DOCX_SAFE_PREVIEW_CHARS = 1400

type DocxLoopResult = {
  success: boolean
  code?: AiTaskResultCode
  message: string
  data?: JsonObject
}

export const executeDocxNode: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const objective = resolveTaskObjective(state, task)
  if (!objective) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'docx capability requires objective input',
      'invalid_input'
    )
  }

  const workspaceId = String(ctx.workspace?.workspaceId || '').trim()
  const workspaceRootPath = String(ctx.workspace?.rootPath || '').trim()
  if (!workspaceId || !workspaceRootPath) {
    ctx.sendEvent({
      type: 'workspace_required',
      runId: state.runId,
      taskId: task.id,
      reason: 'docx capability requires workspace binding before execution',
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now()
    })
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'workspace is required for docx capability',
      'workspace_required'
    )
  }

  const cfg = await ctx.getModelConfig()
  const docx = buildDocxCapabilityTools({
    ctx,
    runId: state.runId,
    taskId: task.id,
    workspaceRootPath,
    safePreviewChars: DOCX_SAFE_PREVIEW_CHARS,
    emitActivity: (activity) => {
      emitActivity({
        ctx,
        runId: state.runId,
        taskId: task.id,
        actionType: activity.actionType,
        status: activity.status,
        summary: activity.summary
      })
    }
  })
  const toolNode = new ToolNode(docx.tools)
  const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(docx.tools)
  const messages: BaseMessage[] = [
    new SystemMessage(
      [
        'You are the `docx` capability.',
        'Use only the tools: docx_inspect, docx_apply_edits, docx_save_output, docx_finish.',
        'Always inspect before applying edits or saving output.',
        'When overwrite is rejected, choose a new save-as output path.',
        'Finish explicitly with docx_finish. Never return plain-text completion.'
      ].join('\n')
    ),
    new HumanMessage(
      [
        `Objective:\n${objective}`,
        `Workspace root:\n${workspaceRootPath}`,
        `Task title:\n${task.title}`,
        `Loop limit:\n${MAX_DOCX_STEPS} tool rounds, ${DOCX_LOOP_TIMEOUT_MS}ms timeout.`,
        task.toolInput?.kind === 'docx' && task.toolInput.sourcePath
          ? `Suggested source path:\n${task.toolInput.sourcePath}`
          : '',
        task.toolInput?.kind === 'docx' && task.toolInput.outputPath
          ? `Suggested output path:\n${task.toolInput.outputPath}`
          : ''
      ]
        .filter(Boolean)
        .join('\n\n')
    )
  ]

  const loopResult = await runBoundedLoop<DocxLoopResult>({
    maxSteps: MAX_DOCX_STEPS,
    timeoutMs: DOCX_LOOP_TIMEOUT_MS,
    onRound: async () => {
      ctx.checkCancelled()
      const ai = (await model.invoke(messages)) as AIMessage
      messages.push(ai)
      const toolCalls = getToolCalls(ai)
      if (toolCalls.length === 0) {
        const rawText = getMessageText(ai.content).trim()
        return {
          done: true as const,
          value: {
            success: false,
            code: 'invalid_input' as const,
            message: rawText || 'docx capability must continue via docx tools'
          }
        }
      }

      const out = await toolNode.invoke({ messages: [ai] })
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)

      if (!docx.state.finish.done) {
        return { done: false as const }
      }

      if (docx.state.finish.success) {
        return {
          done: true as const,
          value: {
            success: true,
            code: 'ok' as const,
            message: docx.state.finish.summary || 'docx objective completed',
            data: docx.state.outputPath
              ? {
                  outputPath: docx.state.outputPath
                }
              : undefined
          }
        }
      }

      return {
        done: true as const,
        value: {
          success: false,
          code:
            docx.state.finish.resultCode && docx.state.finish.resultCode !== 'ok'
              ? docx.state.finish.resultCode
              : 'failed',
          message: docx.state.finish.summary || 'docx capability finished with failure'
        }
      }
    }
  })

  if (!loopResult.ok) {
    if (loopResult.reason === 'timeout') {
      return markTaskFailed(
        ctx,
        state,
        task.id,
        `docx loop timed out after ${DOCX_LOOP_TIMEOUT_MS}ms`,
        'bounded_loop_error',
        {
          timeoutMs: DOCX_LOOP_TIMEOUT_MS,
          rounds: loopResult.rounds
        }
      )
    }
    return markTaskFailed(
      ctx,
      state,
      task.id,
      `docx capability exceeded max steps (${MAX_DOCX_STEPS})`,
      'bounded_loop_error',
      {
        maxSteps: MAX_DOCX_STEPS,
        rounds: loopResult.rounds
      }
    )
  }

  if (!loopResult.value.success) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      loopResult.value.message,
      loopResult.value.code && loopResult.value.code !== 'ok' ? loopResult.value.code : 'failed',
      loopResult.value.data
    )
  }

  return completeTask({
    ctx,
    state,
    task,
    code: 'ok',
    message: loopResult.value.message,
    outputText: loopResult.value.message,
    data: loopResult.value.data
  })
}
