import { randomUUID } from 'node:crypto'
import { MAX_CONCURRENT_SUBAGENTS } from '../constants'
import type { AiRunDeps, AiRunStartPayload, AiRunState, AiTranscript, SubagentTask } from '../types'
import type { ChatMessageLogRecord, SubagentUpdate } from '../../../../shared/types'
import { terminalSessionManager } from '../human/tools/terminal/TerminalSessionManager'
import { SubagentBlockedError } from './toolPolicy'

const actionLabels: Record<string, string> = {
  learn_skill: '学习任务技能',
  update_plan: '更新任务计划',
  read_image: '查看图片',
  terminal_run: '执行命令',
  terminal_read: '读取命令结果',
  text_file_read: '读取文本文件',
  text_file_search: '查找文本',
  text_file_edit: '修改文本文件',
  web_search: '查询网页资料',
  browser_use: '操作网页',
  docx_read_outline: '查看文档结构',
  docx_read_nodes: '读取文档内容',
  docx_search: '查找文档内容',
  docx_content_edit: '编辑文档',
  docx_format: '调整文档格式',
  docx_table_edit: '编辑文档表格',
  docx_comments_revisions: '处理文档修订',
  excel_read: '读取工作表',
  excel_edit: '编辑工作表',
  ppt_read_outline: '查看演示文稿结构',
  ppt_read_slides: '读取幻灯片',
  ppt_search: '查找幻灯片',
  ppt_edit: '编辑演示文稿',
  pdf_outline: '查看 PDF 结构',
  pdf_read_pages: '读取 PDF',
  pdf_search: '查找 PDF',
  kb_search: '查询知识库',
  kb_list_documents: '查看资料目录',
  image_generate: '生成图片'
}

const actionText = (toolName: string, input: object): string => {
  let label = actionLabels[toolName] || '执行工具'
  if (toolName === 'browser_use' && 'action' in input && typeof input.action === 'string') {
    label =
      (
        {
          navigate: '打开网页',
          list_tabs: '查看自己的标签',
          observe: '查看页面操作',
          act: '操作网页',
          extract: '提取网页内容',
          screenshot: '查看页面截图',
          scroll: '滚动页面',
          back: '返回上一页'
        } as Record<string, string>
      )[input.action] || label
  }
  if (toolName === 'web_search' && 'type' in input && input.type === 'fetch') label = '读取网页资料'
  for (const key of ['instruction', 'commandExplanation', 'query', 'url', 'sourcePath']) {
    if (key in input) {
      const value = Reflect.get(input, key)
      if (typeof value === 'string' && value.trim())
        return `${label}：${value.trim().replace(/\s+/g, ' ')}`.slice(0, 180)
    }
  }
  return label
}

export const createMemoryTranscript = (
  partnerId: string,
  runId: string
): AiTranscript & { clear: () => void } => {
  const records: ChatMessageLogRecord[] = []
  return {
    append: async (entries) => {
      for (const entry of entries)
        records.push({
          id: randomUUID(),
          partnerId,
          runId,
          seq: records.length + 1,
          entry,
          createdAt: Date.now()
        })
    },
    load: async () => records.slice(),
    clear: () => {
      records.length = 0
    }
  }
}

export const createSubagentDispatcher = (
  payload: AiRunStartPayload,
  deps: AiRunDeps,
  getModelConfig: () => Promise<import('../../../../shared/types').LlmRuntimeConfig>,
  run: (payload: AiRunStartPayload, deps: AiRunDeps) => Promise<AiRunState>
): NonNullable<AiRunDeps['delegateToSubagent']> => {
  let activeCount = 0
  return async (tasks: SubagentTask[], toolCallId: string) => {
    if (payload.parentToolCallId) throw new SubagentBlockedError('子任务不能再次派发')
    if (!tasks.length || activeCount + tasks.length > MAX_CONCURRENT_SUBAGENTS)
      throw new Error(`每个主任务最多同时运行 ${MAX_CONCURRENT_SUBAGENTS} 个子任务`)
    activeCount += tasks.length
    try {
      const modelConfig = await getModelConfig()
      const results = await Promise.allSettled(
        tasks.map(async (task): Promise<SubagentUpdate> => {
          const childRunId = randomUUID()
          const transcript = createMemoryTranscript(payload.partnerId, childRunId)
          const controller = new AbortController()
          const cancel = (): void => {
            controller.abort()
            void terminalSessionManager.closeByChatSession(childRunId).catch(() => {})
          }
          deps.abortSignal?.addEventListener('abort', cancel, { once: true })
          if (deps.abortSignal?.aborted || deps.isCancelled()) cancel()
          const base: SubagentUpdate = {
            toolCallId,
            childRunId,
            name: task.name,
            task: task.task,
            status: 'running'
          }
          let updates = Promise.resolve()
          let blocker: string | undefined
          const actions = new Map<string, string>()
          const publish = (update: SubagentUpdate): Promise<void> => {
            const next = updates.then(async () => {
              await deps.chatMessageLogStore.appendBatch({
                partnerId: payload.partnerId,
                runId: payload.runId,
                entries: [{ kind: 'annotation', eventType: 'subagent_updated', payload: update }]
              })
              deps.sendEvent({
                type: 'subagent_updated',
                runId: payload.runId,
                update,
                createdAt: Date.now()
              })
            })
            updates = next
            // Event emission is synchronous; final delivery awaits the persisted stream.
            void next.catch(() => {})
            return next
          }
          const needParent = (message: string): never => {
            blocker = message
            throw new SubagentBlockedError(message)
          }
          try {
            await publish(base)
            const output = await run(
              {
                ...payload,
                runId: childRunId,
                ownerRunId: payload.ownerRunId || payload.runId,
                parentToolCallId: toolCallId,
                userMessageId: randomUUID(),
                assistantMessageId: randomUUID(),
                input: task.task,
                contentNodes: undefined
              },
              {
                ...deps,
                modelConfig,
                transcript,
                delegateToSubagent: undefined,
                hasPendingUserMessages: undefined,
                waitForPendingUserMessageSubmissions: undefined,
                abortSignal: controller.signal,
                isCancelled: () => controller.signal.aborted || deps.isCancelled(),
                requestApprovalBatch: async () =>
                  needParent('子任务需要人工审批，请由主伙伴继续处理'),
                requestUserQuestion: async () => needParent('子任务需要用户协助，请由主伙伴询问'),
                sendEvent: (event) => {
                  // Only public tool actions are persisted. Brain text, skills, plans and lifecycle remain local.
                  if (event.type === 'tool_call_started') {
                    const text = actionText(event.toolName, event.input)
                    actions.set(event.toolCallId, text)
                    void publish({
                      ...base,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text:
                          actions.get(event.toolCallId) ||
                          actionLabels[event.toolName] ||
                          '执行工具',
                        status: 'running'
                      }
                    })
                  } else if (event.type === 'tool_call_result') {
                    void publish({
                      ...base,
                      action: {
                        id: event.toolCallId,
                        toolName: event.toolName,
                        text:
                          actions.get(event.toolCallId) ||
                          actionLabels[event.toolName] ||
                          '执行工具',
                        status: event.error || event.result?.ok === false ? 'failed' : 'completed',
                        feedback:
                          event.error ||
                          (typeof event.result?.data === 'object' &&
                          event.result.data &&
                          !Array.isArray(event.result.data) &&
                          typeof event.result.data.message === 'string'
                            ? event.result.data.message.slice(0, 2000)
                            : undefined)
                      }
                    })
                  } else if (event.type === 'browser_panel_opened') {
                    deps.sendEvent({ ...event, runId: payload.runId, background: true })
                  } else if (event.type === 'file_artifact') {
                    deps.sendEvent({ ...event, runId: payload.runId })
                  }
                },
                recordLlmIo: deps.recordLlmIo
                  ? (record) =>
                      deps.recordLlmIo?.({
                        ...record,
                        ownerRunId: payload.runId,
                        parentToolCallId: toolCallId
                      })
                  : undefined
              }
            )
            const update: SubagentUpdate = {
              ...base,
              status:
                blocker || output.needsParent
                  ? 'blocked'
                  : output.status === 'completed'
                    ? 'completed'
                    : output.status === 'cancelled'
                      ? 'cancelled'
                      : 'failed',
              result: (
                blocker ||
                output.finalDeliveryMarkdown ||
                output.error ||
                '执行被中断，未收到完整结果'
              ).slice(0, 12000),
              artifacts: output.finalArtifacts
            }
            await publish(update)
            return update
          } finally {
            try {
              await updates
            } finally {
              transcript.clear()
              deps.abortSignal?.removeEventListener('abort', cancel)
            }
          }
        })
      )
      return results.map((result) => {
        if (result.status === 'rejected') throw result.reason
        return result.value
      })
    } finally {
      activeCount -= tasks.length
    }
  }
}
