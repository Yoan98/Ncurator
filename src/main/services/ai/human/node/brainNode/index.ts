import { randomUUID } from 'node:crypto'
import { SystemMessage } from '@langchain/core/messages'
import { getToolCalls } from '../../../../../utils/aiCapabilityUtils'
import { extractTextContent, tryRepairJsonObject } from '../../../structuredOutput'
import type { JsonObject } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { isContentSafetyError } from '../../../utils/runFailure'
import { normalizeRoundThought } from '../../memory/thoughtMemory'
import { buildBrainSystemPrompt, buildBrainUserMessage } from '../../prompts/brain'
import { projectMessageLogRecords } from '../../memory/transcript'
import { assertExternalLearnedSkillIds } from '../../skills'
import type { HumanRuntimeCache, HumanState } from '../../types'
import { applyBrainDispatchTransition, returnToBrain } from '../utils/stateTransitions'
import { buildAvailableTools } from '../learningNode/skillLoader'
import {
  createDeliveryGuidanceItem,
  mergeDeliveryGuidanceItems
} from '../../shared/deliveryGuidance'
import { buildDispatchQueue } from '../dispatch'
import { appendToolFeedback } from '../../shared/toolFeedback'
import { formatZodErrorForTool, type ZodIssueLike } from '../../shared/schemaError'
import { normalizeToolCallArgs } from '../../shared/toolArgsNormalize'
import { estimateMessagesForContext, projectMessagesForMainModel } from '../../memory/multimodal'
import {
  emitThinkingCompleted,
  emitThinkingFailed,
  emitThinkingStarted
} from '../../../events/processEvents'
import {
  applyDeliverySideEffects,
  buildContentSafetyFallbackMarkdown,
  completeDelivery,
  finalizeDelivery
} from './finalizeDelivery'
import { createCurrentBrainUserMessage } from '../utils/messageTail'
import { LlmOutputTruncatedError } from '../../../errors'

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

export const createBrainNode = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  emitAnswerEvents: boolean
}) => {
  return async (state: HumanState): Promise<HumanState> => {
    input.ctx.checkCancelled()
    assertExternalLearnedSkillIds(state.skills.learnedSkillIds)
    input.cache.currentState = state

    const injectPlan = state.memory.plan.length > 0
    let messages = input.cache.messages
    if (!messages || messages.length === 0 || input.cache.currentUserMessageIndex === undefined) {
      const projection = projectMessageLogRecords(await input.ctx.loadMessageLog())
      messages = [
        new SystemMessage(buildBrainSystemPrompt({ ctx: input.ctx })),
        ...projection.messages,
        createCurrentBrainUserMessage(
          buildBrainUserMessage({ state, ctx: input.ctx, injectPlan })
        )
      ]
      input.cache.messages = messages
      input.cache.currentUserMessageIndex = messages.length - 1
    } else {
      // 每轮刷新 user 消息，保证 plan / learned_skills / compacted_history 都是最新 state 渲染，
      // 避免 update_plan / learn_skill 之后后续 brain 轮次仍看到旧快照（"丢 plan"）。
      const humanIndex = input.cache.currentUserMessageIndex
      const refreshedHuman = createCurrentBrainUserMessage(
        buildBrainUserMessage({
          state,
          ctx: input.ctx,
          injectPlan
        })
      )
      if (humanIndex >= 0 && humanIndex < messages.length) {
        messages[humanIndex] = refreshedHuman
      } else {
        messages.push(refreshedHuman)
        input.cache.currentUserMessageIndex = messages.length - 1
      }
    }

    const tools = buildAvailableTools({
      cache: input.cache,
      ctx: input.ctx,
      runId: input.ctx.runId,
      taskId: state.task.taskId,
      learnedSkillIds: state.skills.learnedSkillIds
    })

    const schemaByToolName = new Map<
      string,
      { safeParse: (data: unknown) => { success: boolean; error?: { issues: ZodIssueLike[] } } }
    >()
    for (const tool of tools) {
      const name = String(tool.name || '').trim()
      if (!name) continue
      const schema = tool.schema
      if (!schema || typeof schema !== 'object') continue
      const safeParse = (schema as { safeParse?: unknown }).safeParse
      if (typeof safeParse !== 'function') continue
      schemaByToolName.set(name, {
        safeParse: safeParse as (data: unknown) => {
          success: boolean
          error?: { issues: ZodIssueLike[] }
        }
      })
    }

    let thinkingOpen = false
    const completeThinking = (): void => {
      if (!thinkingOpen) return
      emitThinkingCompleted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
      thinkingOpen = false
    }
    const failThinking = (error: unknown): void => {
      if (!thinkingOpen) return
      emitThinkingFailed({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId,
        error: getErrorMessage(error)
      })
      thinkingOpen = false
    }

    try {
      emitThinkingStarted({
        sendEvent: input.ctx.sendEvent,
        runId: input.ctx.runId
      })
      thinkingOpen = true
      await input.ctx.appendMessageLog([
        { kind: 'annotation', eventType: 'thinking_started', payload: {} }
      ])

      const projectedMessages = await projectMessagesForMainModel(messages)
      const requestMessageTokenEstimate = estimateMessagesForContext(messages)
      const roundId = randomUUID()
      let streamClassifiedAsThought = false
      input.ctx.sendEvent({
        type: 'assistant_brain_stream_started',
        runId: input.ctx.runId,
        roundId,
        createdAt: Date.now(),
        stage: 'human_brain'
      })
      const classifyStreamAsThought = (): void => {
        if (streamClassifiedAsThought) return
        streamClassifiedAsThought = true
        input.ctx.sendEvent({
          type: 'assistant_brain_stream_classified',
          runId: input.ctx.runId,
          roundId,
          role: 'thought',
          createdAt: Date.now(),
          stage: 'human_brain'
        })
      }
      const result = await input.ctx.chatTools({
        caller: 'human.brain',
        taskId: state.task.taskId,
        messages: projectedMessages,
        tools,
        temperature: 0.1,
        contextBudgetSnapshot: state.execution.contextBudget,
        onTextDelta: (text) => {
          input.ctx.sendEvent({
            type: 'assistant_brain_stream_delta',
            runId: input.ctx.runId,
            roundId,
            text,
            createdAt: Date.now(),
            stage: 'human_brain'
          })
        },
        onTextReset: () => {
          streamClassifiedAsThought = false
          input.ctx.sendEvent({
            type: 'assistant_brain_stream_reset',
            runId: input.ctx.runId,
            roundId,
            createdAt: Date.now(),
            stage: 'human_brain'
          })
        },
        onToolCallDelta: classifyStreamAsThought
      })

      const inputTokens = result.usage?.inputTokens
      if (inputTokens !== undefined) {
        input.cache.lastBrainInputTokens = inputTokens
        input.cache.lastBrainMessageTokenEstimate = requestMessageTokenEstimate
        input.cache.postCompactionNeedsFreshBrainUsage = false
        input.cache.lastBrainUsageUnavailable = false
      } else {
        input.cache.lastBrainUsageUnavailable = true
        input.ctx.sendEvent({
          type: 'runtime_issue',
          runId: input.ctx.runId,
          taskId: state.task.taskId,
          code: 'llm_usage_unavailable',
          message: '当前模型调用未返回 brain 输入 token usage，暂不基于真实 usage 触发上下文压缩。',
          createdAt: Date.now(),
          stage: 'human_brain'
        })
      }

      const assistantMessage = result.message
      const validToolCalls = getToolCalls(assistantMessage)
      // invalid_tool_calls 是 LangChain 对 `arguments` 做 JSON.parse 失败后单独分出来的
      // 一批调用。它的 `error` 字段是 SDK 面向开发者的文案（args 回显 + Troubleshooting URL），
      // 不直接回传给模型；这里只用 `invalidCall.args` 原始串自己修复并生成干净错误。
      const invalidToolCalls = Array.isArray(assistantMessage.invalid_tool_calls)
        ? assistantMessage.invalid_tool_calls
        : []
      const assembledText = extractTextContent(assistantMessage.content)

      if (result.finishReason === 'content_filter') {
        const error = new Error('content_filter') as Error & { code?: string }
        error.code = 'CONTENT_FILTER'
        throw error
      }
      if (result.finishReason === 'length') {
        await input.ctx.appendMessageLog([
          { kind: 'assistant', content: assembledText, toolCalls: [] }
        ])
        input.ctx.sendEvent({
          type: 'assistant_brain_stream_completed',
          runId: input.ctx.runId,
          roundId,
          role: 'answer',
          text: assembledText,
          completedAt: Date.now(),
          stage: 'human_brain'
        })
        throw new LlmOutputTruncatedError(assembledText)
      }
      if (
        result.finishReason === 'tool_calls' &&
        validToolCalls.length === 0 &&
        invalidToolCalls.length === 0
      ) {
        throw new Error('模型声明了工具调用，但没有返回任何工具调用内容。')
      }
      const dispatchableCalls: Parameters<typeof buildDispatchQueue>[0] = []
      const unrecoverableCalls: Array<{ id?: string; name: string; errorMessage: string }> = []

      for (const call of validToolCalls) {
        const id = typeof call.id === 'string' && call.id.trim() ? call.id : undefined
        const name = typeof call.name === 'string' ? call.name : ''
        if (id) {
          dispatchableCalls.push({
            id,
            name,
            args: (call.args || {}) as Record<string, unknown>
          })
        } else {
          unrecoverableCalls.push({
            name,
            errorMessage: 'The tool call is missing tool_call_id and was not executed.'
          })
        }
      }
      for (const invalidCall of invalidToolCalls) {
        const repaired = tryRepairJsonObject(invalidCall.args)
        const id =
          typeof invalidCall.id === 'string' && invalidCall.id.trim() ? invalidCall.id : undefined
        const name = typeof invalidCall.name === 'string' ? invalidCall.name : ''
        if (!id) {
          unrecoverableCalls.push({
            name,
            errorMessage: 'The tool call is missing tool_call_id and was not executed.'
          })
        } else if (repaired.ok) {
          dispatchableCalls.push({ id, name, args: repaired.value })
        } else {
          unrecoverableCalls.push({
            id,
            name,
            errorMessage: `Tool ${name || 'unknown'} arguments are not valid JSON and were not executed. Generate the tool call again with valid JSON. Details: ${repaired.error}`
          })
        }
      }

      // 在进入 hand 节点前，用工具自身的 schema 自行校验参数，避免 LangChain 内部校验
      // 抛出只有路径、没有字段与期望值的 terse 错误。learn_skill/update_plan 由各自
      // 节点负责校验，这里跳过 schema，但仍统一做嵌套 JSON 字符串展开。
      const NODE_OWNED_TOOL_NAMES = new Set(['learn_skill', 'update_plan'])
      const schemaInvalidCalls: Array<{ id?: string; name: string; errorMessage: string }> = []
      const executableCalls: Parameters<typeof buildDispatchQueue>[0] = []
      for (const call of dispatchableCalls) {
        const args = normalizeToolCallArgs(call.args ?? {})
        if (NODE_OWNED_TOOL_NAMES.has(call.name)) {
          executableCalls.push({ ...call, args })
          continue
        }
        const schema = schemaByToolName.get(call.name)
        if (!schema) {
          executableCalls.push({ ...call, args })
          continue
        }
        const parsed = schema.safeParse(args)
        if (parsed.success) {
          executableCalls.push({ ...call, args })
        } else {
          schemaInvalidCalls.push({
            id: call.id,
            name: call.name,
            errorMessage: formatZodErrorForTool(call.name, { issues: parsed.error?.issues ?? [] })
          })
        }
      }

      const hasAnyToolCall =
        executableCalls.length > 0 ||
        unrecoverableCalls.length > 0 ||
        schemaInvalidCalls.length > 0
      if (hasAnyToolCall) classifyStreamAsThought()
      input.ctx.sendEvent({
        type: 'assistant_brain_stream_completed',
        runId: input.ctx.runId,
        roundId,
        role: hasAnyToolCall ? 'thought' : 'answer',
        text: assembledText,
        completedAt: Date.now(),
        stage: 'human_brain'
      })

      messages.push(assistantMessage)
      input.cache.messages = messages
      await input.ctx.appendMessageLog([
        {
          kind: 'assistant',
          content: extractTextContent(assistantMessage.content),
          toolCalls: [
            ...executableCalls.map((call) => ({
              id: call.id,
              name: call.name,
              args: call.args as JsonObject
            })),
            ...unrecoverableCalls.map((call, index) => ({
              id: call.id || `invalid-${input.cache.toolCallCount}-0-${index}`,
              name: call.name,
              args: {} as JsonObject
            })),
            ...schemaInvalidCalls.map((call, index) => ({
              id:
                call.id ||
                `invalid-${input.cache.toolCallCount}-${unrecoverableCalls.length}-${index}`,
              name: call.name,
              args: {} as JsonObject
            }))
          ]
        }
      ])

      const thoughtText = assembledText
      const thought = normalizeRoundThought(thoughtText)

      const appendInvalidFeedback = async (
        calls: Array<{ id?: string; name: string; errorMessage: string }>,
        offset: number
      ): Promise<void> => {
        for (const [index, call] of calls.entries()) {
          await appendToolFeedback({
            cache: input.cache,
            ctx: input.ctx,
            toolCallId: call.id || `invalid-${input.cache.toolCallCount}-${offset}-${index}`,
            toolName: call.name || 'unknown',
            ok: false,
            errorMessage: call.errorMessage
          })
        }
      }

      if (unrecoverableCalls.length > 0 || schemaInvalidCalls.length > 0) {
        await appendInvalidFeedback(unrecoverableCalls, 0)
        await appendInvalidFeedback(schemaInvalidCalls, unrecoverableCalls.length)

        if (executableCalls.length === 0) {
          completeThinking()
          await input.ctx.appendMessageLog([
            { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
          ])
          return returnToBrain(state)
        }
      }

      if (executableCalls.length === 0) {
        const deliveryMarkdown = thoughtText
        completeThinking()
        await input.ctx.appendMessageLog([
          { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
        ])
        return await finalizeDelivery({
          ctx: input.ctx,
          cache: input.cache,
          state,
          deliveryMarkdown,
          emitAnswerEvents: input.emitAnswerEvents
        })
      }

      const dispatchQueue = buildDispatchQueue(executableCalls)

      completeThinking()
      await input.ctx.appendMessageLog([
        { kind: 'annotation', eventType: 'thinking_completed', payload: {} }
      ])
      return applyBrainDispatchTransition({
        ctx: input.ctx,
        cache: input.cache,
        state,
        thought,
        dispatchQueue
      })
    } catch (error) {
      if (isContentSafetyError(error)) {
        completeThinking()
        const guidance = createDeliveryGuidanceItem(
          'brain',
          '本次处理受到服务端内容安全策略限制，无法继续执行。请调整输入内容或相关资料后重试。'
        )
        const stateWithGuidance: HumanState = {
          ...state,
          execution: {
            ...state.execution,
            deliveryGuidanceItems: mergeDeliveryGuidanceItems(
              state.execution.deliveryGuidanceItems,
              guidance
            )
          }
        }
        const readyState = await applyDeliverySideEffects({
          ctx: input.ctx,
          cache: input.cache,
          state: stateWithGuidance
        })
        const fallbackMarkdown = buildContentSafetyFallbackMarkdown(readyState)
        await input.ctx.appendMessageLog([
          { kind: 'assistant', content: fallbackMarkdown, toolCalls: [] }
        ])
        return completeDelivery({
          ctx: input.ctx,
          cache: input.cache,
          state: readyState,
          deliveryMarkdown: fallbackMarkdown,
          emitAnswerEvents: input.emitAnswerEvents
        })
      }

      failThinking(error)
      throw error
    }
  }
}
