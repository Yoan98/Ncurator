import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ToolNode } from '@langchain/langgraph/prebuilt'
import { createChatModel } from '../../../../llm/chatModel'
import { buildRetrievalTools } from './retrievalTools'
import {
  CapabilityExecutor,
  JsonTaskResult,
  completeTask,
  getMessageText,
  getToolCalls,
  getToolNodeMessages,
  markTaskFailed,
  parseJsonObject
} from '../../../../../utils/aiCapabilityUtils'

const MAX_RETRIEVAL_DISPATCH_STEPS = 3
const MAX_TOOL_ROUNDS_PER_DISPATCH = 3

export const executeLocalKbRetrievalNode: CapabilityExecutor = async (ctx, state, task) => {
  ctx.checkCancelled()

  const tools = buildRetrievalTools({ ctx, runId: state.runId, taskId: task.id })
  const toolNode = new ToolNode(tools)
  const cfg = await ctx.getModelConfig()
  const model = createChatModel(cfg, { temperature: 0.2 }).bindTools(tools)

  const system = [
    'You are the `local_kb_retrieval` capability.',
    'Use retrieval tools to gather minimal evidence for this task.',
    'If evidence is enough, output JSON only as {"satisfied": true, "note": "short"}.',
    'If not enough, output JSON only as {"satisfied": false, "note": "short"}.',
    'Do not output any extra keys.'
  ].join('\n')
  const scopedDocumentIdsText =
    Array.isArray(ctx.selectedDocumentIds) && ctx.selectedDocumentIds.length > 0
      ? ctx.selectedDocumentIds.join(', ')
      : '(none)'
  const user = `User input:\n${state.input}\n\nTask:\n${String(task.title || task.id)}\n\nCurrent attempt: ${Number(task.attempts || 0) + 1}/${MAX_RETRIEVAL_DISPATCH_STEPS}\n\nScoped document ids from run context:\n${scopedDocumentIdsText}\n\nIf scope exists, keep retrieval within that scope by default.`

  let satisfied = false
  let note = ''
  let lastAi: AIMessage | null = null
  const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(user)]

  for (let i = 0; i < MAX_TOOL_ROUNDS_PER_DISPATCH; i += 1) {
    ctx.checkCancelled()
    const ai = (await model.invoke(messages)) as AIMessage
    lastAi = ai
    messages.push(ai)

    const toolCalls = getToolCalls(ai)
    if (toolCalls.length > 0) {
      const out = await toolNode.invoke({ messages: [ai] })
      const toolMessages = getToolNodeMessages(out)
      messages.push(...toolMessages)
      continue
    }

    const content = getMessageText(ai.content)
    try {
      const json = parseJsonObject<JsonTaskResult>(content)
      satisfied = Boolean(json.satisfied)
      note = String(json.note || '')
    } catch (e) {
      void e
      satisfied = false
      note = ''
    }
    break
  }

  const attempts = Number(task.attempts || 0) + 1
  if (satisfied) {
    return completeTask({
      ctx,
      state,
      task,
      code: 'ok',
      message: note || undefined,
      outputText: note || state.outputText
    })
  }

  if (attempts >= MAX_RETRIEVAL_DISPATCH_STEPS) {
    const err = note || 'local_kb_retrieval not satisfied'
    return markTaskFailed(ctx, state, task.id, err)
  }

  const plan = (state.plan || []).map((t) =>
    t.id === task.id
      ? {
          ...t,
          attempts,
          status: 'running' as const,
          error: undefined,
          resultCode: undefined,
          resultMessage: undefined,
          resultData: undefined
        }
      : t
  )

  return {
    plan,
    activeTaskId: undefined,
    outputText: note || getMessageText(lastAi?.content) || state.outputText
  }
}
