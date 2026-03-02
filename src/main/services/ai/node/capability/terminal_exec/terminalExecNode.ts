import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import type { AiTaskResultCode, JsonObject } from '../../../../../../shared/types'
import { runBoundedLoop } from '../../../../../utils/boundedLoop'
import { createChatModel } from '../../../../llm/chatModel'
import { buildTerminalCapabilityTools } from './terminalTools'
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

const MAX_TERMINAL_STEPS = 6
const TERMINAL_LOOP_TIMEOUT_MS = 60000
const TERMINAL_TIMEOUT_MS = 15000
const TERMINAL_MAX_OUTPUT_CHARS = 8000
const TERMINAL_SAFE_PREVIEW_CHARS = 600

type TerminalLoopResult = {
  success: boolean
  code?: AiTaskResultCode
  message: string
  data?: JsonObject
}

export const executeTerminalExecNode: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const objective = resolveTaskObjective(state, task)
  if (!objective) {
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'terminal_exec requires objective input',
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
      reason: 'terminal_exec requires workspace binding before execution',
      requiredFields: ['workspaceId', 'rootPath'],
      createdAt: Date.now()
    })
    return markTaskFailed(
      ctx,
      state,
      task.id,
      'workspace is required for terminal_exec',
      'workspace_required'
    )
  }

  const cfg = await ctx.getModelConfig()
  const terminal = buildTerminalCapabilityTools({
    ctx,
    runId: state.runId,
    taskId: task.id,
    workspaceRootPath,
    timeoutMs: TERMINAL_TIMEOUT_MS,
    maxOutputChars: TERMINAL_MAX_OUTPUT_CHARS,
    safePreviewChars: TERMINAL_SAFE_PREVIEW_CHARS,
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
  const toolNode = new ToolNode(terminal.tools)
  const model = createChatModel(cfg, { temperature: 0.1 }).bindTools(terminal.tools)
  const messages: BaseMessage[] = [
    new SystemMessage(
      [
        'You are the `terminal_exec` capability.',
        'User provides natural-language objective. Do not assume raw shell command input.',
        'Only execute shell commands through tool `terminal_run_command`.',
        'Never claim completion in plain text. Finish only by calling `terminal_finish`.',
        'When commands write files, always include `expectedArtifacts` in `terminal_run_command`.',
        'If a command is unsafe or blocked, adapt strategy and then call `terminal_finish` with success=false when objective cannot continue.'
      ].join('\n')
    ),
    new HumanMessage(
      `Objective:\n${objective}\n\nWorkspace root:\n${workspaceRootPath}\n\nTask title:\n${task.title}\n\nLoop limit:\n${MAX_TERMINAL_STEPS} tool rounds, ${TERMINAL_LOOP_TIMEOUT_MS}ms timeout.`
    )
  ]

  const loopResult = await runBoundedLoop<TerminalLoopResult>({
    maxSteps: MAX_TERMINAL_STEPS,
    timeoutMs: TERMINAL_LOOP_TIMEOUT_MS,
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
            message: rawText || 'terminal_exec must continue via terminal tools'
          }
        }
      }

      const out = await toolNode.invoke({ messages: [ai] })
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)

      if (!terminal.state.finish.done) {
        return { done: false as const }
      }

      if (terminal.state.finish.success) {
        return {
          done: true as const,
          value: {
            success: true,
            code: 'ok' as const,
            message: terminal.state.finish.summary || 'terminal objective completed',
            data: {
              steps: terminal.state.stepIndex
            }
          }
        }
      }

      return {
        done: true as const,
        value: {
          success: false,
          code:
            terminal.state.finish.resultCode && terminal.state.finish.resultCode !== 'ok'
              ? terminal.state.finish.resultCode
              : 'failed',
          message: terminal.state.finish.summary || 'terminal_exec finished with failure'
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
        `terminal_exec loop timed out after ${TERMINAL_LOOP_TIMEOUT_MS}ms`,
        'bounded_loop_error',
        {
          timeoutMs: TERMINAL_LOOP_TIMEOUT_MS,
          rounds: loopResult.rounds
        }
      )
    }
    return markTaskFailed(
      ctx,
      state,
      task.id,
      `terminal_exec exceeded max steps (${MAX_TERMINAL_STEPS})`,
      'bounded_loop_error',
      {
        maxSteps: MAX_TERMINAL_STEPS,
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
