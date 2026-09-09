import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import {
  buildCompactedMessages,
  createContextCompactionNode
} from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import {
  buildHistoryCompactionPrompt,
  buildTurnPrefixCompactionPrompt,
  joinSplitCompactionSummary,
  wrapCompactionCheckpointContent
} from '../../../../src/main/services/ai/human/prompts/compaction'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../src/shared/types'
import {
  createCompactedBrainUserMessage,
  createCurrentBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  CONTEXT_COMPACTION_TAIL_RATIO,
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  resolveCompactionTailTokens
} from '../../../../src/main/services/ai/human/constants'
import { estimateMessagesForContext } from '../../../../src/main/services/ai/human/memory/multimodal'

const contextWindowForTail = (retainTokens: number): number => {
  let windowTokens = Math.max(
    1,
    Math.ceil(retainTokens / (CONTEXT_COMPACTION_TRIGGER_RATIO * CONTEXT_COMPACTION_TAIL_RATIO))
  )
  while (resolveCompactionTailTokens(windowTokens) < retainTokens) {
    windowTokens += 1
  }
  return windowTokens
}

const createContext = (): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-compaction-shape',
    partnerId: 'partner-compaction-shape',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace-1'],
    runStartedAt: Date.now(),
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
    }
  }) as AiRunContext

describe('ai human context compaction message shape', () => {
  it('rebuilds system, a synthesized checkpoint user, and the retained original tail', () => {
    const current = createCurrentBrainUserMessage('<user_context>继续完成任务</user_context>')
    const tail = [
      current,
      new AIMessage({
        content: '正在写初稿',
        tool_calls: [{ id: '1', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'draft nodes', tool_call_id: '1' })
    ]
    const summary =
      '## 目标\n准备交付\n## 约束与偏好\n无\n## 进度\n无\n## 下一步\n无\n## 关键上下文\n无'

    const messages = buildCompactedMessages({
      ctx: createContext(),
      summary,
      tail
    })

    expect(messages.map((message) => message.getType())).toEqual([
      'system',
      'human',
      'human',
      'ai',
      'tool'
    ])
    expect(messages[2]).toBe(current)
    expect(messages[3]).toBe(tail[1])
    expect(messages[4]).toBe(tail[2])
    const compactionUser = String(messages[1]?.content)
    expect(compactionUser).toBe(wrapCompactionCheckpointContent(summary))
    expect(compactionUser).toContain('<summary>')
    expect(compactionUser).toContain('## 目标')
    expect(compactionUser).not.toContain('<user_context>')
    expect(compactionUser).not.toContain('<memory>')
    expect(compactionUser).not.toContain('<active_state>')
  })
})

describe('ai human history compaction prompt', () => {
  it('puts the format in the user message and locks the system role', () => {
    const prompt = buildHistoryCompactionPrompt({
      conversationText: '[user]\n填周报\n\n[ai] 已读上周'
    })
    expect(prompt.system).toContain('你是上下文摘要助手')
    expect(prompt.system).toContain('只输出结构化摘要')
    expect(prompt.system).not.toContain('## 目标')
    expect(prompt.user).toContain('<conversation>')
    expect(prompt.user).toContain('[user]')
    expect(prompt.user).toContain('填周报')
    expect(prompt.user).toContain('已读上周')
    expect(prompt.user).toContain('结构化的上下文检查点摘要')
    expect(prompt.user).toContain('供后续模型继续工作')
    expect(prompt.user).toContain('## 约束与偏好')
    expect(prompt.user).toContain('## 进度')
    expect(prompt.user).toContain('## 关键决策')
    expect(prompt.user).toContain('## 下一步')
    expect(prompt.user).toContain('## 关键上下文')
    expect(prompt.user).not.toContain('[round')
    expect(prompt.user).not.toContain('<previous-summary>')
    expect(prompt.user).not.toContain('保留旧摘要里已有的信息')
    expect(prompt.user).toContain('各栏保持简短')
  })

  it('uses the turn-prefix instruction without a previous summary', () => {
    const prompt = buildTurnPrefixCompactionPrompt({
      conversationText: '[user]\n改成按部门汇总'
    })
    expect(prompt.system).toBe(buildHistoryCompactionPrompt({ conversationText: 'x' }).system)
    expect(prompt.user).toContain('## 原始请求')
    expect(prompt.user).toContain('## 前期进展')
    expect(prompt.user).toContain('## 后缀所需上下文')
    expect(prompt.user).not.toContain('<previous-summary>')
  })

  it('joins split-turn summaries with a turn-context marker', () => {
    expect(joinSplitCompactionSummary('历史摘要', '前半轮摘要')).toContain(
      '**Turn Context (split turn):**'
    )
    expect(joinSplitCompactionSummary('', '前半轮摘要')).toContain('无更早历史')
  })
})

const logRecord = (
  seq: number,
  entry: ChatMessageLogEntry,
  runId = 'run-compaction-shape'
): ChatMessageLogRecord => ({
  id: `log-${seq}`,
  partnerId: 'partner-compaction-shape',
  runId,
  seq,
  entry,
  createdAt: seq
})

describe('ai human context compaction node', () => {
  it('writes only a checkpoint with summary and synthesizes the user at runtime', async () => {
    const current = createCurrentBrainUserMessage('continue the task')
    const earlierUser = new HumanMessage('old task')
    const earlierPair = [
      new AIMessage({
        content: 'old work',
        tool_calls: [{ id: '1', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'old result', tool_call_id: '1' })
    ]
    const tailPair = [
      new AIMessage({
        content: 'current work',
        tool_calls: [{ id: '2', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'current result', tool_call_id: '2' })
    ]
    const appended: ChatMessageLogEntry[] = []
    const prompts: Array<{ system: string; user: string }> = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(
          estimateMessagesForContext([current, ...tailPair])
        )
      },
      loadMessageLog: async () => [
        logRecord(1, {
          kind: 'user',
          content: 'old task',
          context: { selectedReferences: [], attachments: [] }
        }),
        logRecord(2, {
          kind: 'assistant',
          content: 'old work',
          toolCalls: [{ id: '1', name: 'docx_read_nodes', args: {} }]
        }),
        logRecord(3, {
          kind: 'tool',
          toolCallId: '1',
          toolName: 'docx_read_nodes',
          ok: true,
          content: 'old result'
        }),
        logRecord(4, {
          kind: 'user',
          content: 'continue the task',
          context: { selectedReferences: [], attachments: [] }
        }),
        logRecord(5, {
          kind: 'assistant',
          content: 'current work',
          toolCalls: [{ id: '2', name: 'docx_read_nodes', args: {} }]
        }),
        logRecord(6, {
          kind: 'tool',
          toolCallId: '2',
          toolName: 'docx_read_nodes',
          ok: true,
          content: 'current result'
        })
      ],
      appendMessageLog: async (entries) => {
        appended.push(...entries)
      },
      chatText: async (request) => {
        prompts.push({ system: request.system, user: request.user })
        return '## 目标\n继续交付'
      },
      checkCancelled: () => undefined,
      sendEvent: () => undefined
    } as AiRunContext
    const cache = createHumanRuntimeCache()
    cache.messages = [earlierUser, ...earlierPair, current, ...tailPair]
    cache.currentUserLogAppended = true
    const node = createContextCompactionNode({ ctx, cache })
    const next = await node(
      createInitialHumanState({
        taskId: 'task-compact',
        userInput: 'continue the task'
      })
    )

    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.user).toContain('<conversation>')
    expect(prompts[0]?.user).not.toContain('<previous-summary>')
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'compaction_checkpoint'
    })
    if (appended[0]?.kind === 'annotation' && appended[0].eventType === 'compaction_checkpoint') {
      expect(appended[0].payload.summary).toContain('## 目标')
    }
    expect(cache.messages?.[1] && String(cache.messages[1].content)).toBe(
      wrapCompactionCheckpointContent('## 目标\n继续交付')
    )
    expect(next.execution.stage).toBe('context_budget')
  })

  it('throws internal_error when coveredThroughSeq cannot be resolved', async () => {
    const current = createCurrentBrainUserMessage('continue the task')
    const earlierUser = new HumanMessage('old task')
    const earlierPair = [
      new AIMessage({
        content: 'old work',
        tool_calls: [{ id: '1', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'old result', tool_call_id: '1' })
    ]
    const tailPair = [
      new AIMessage({
        content: 'current work',
        tool_calls: [{ id: '2', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'current result', tool_call_id: '2' })
    ]
    const prompts: Array<{ system: string; user: string }> = []
    const appended: ChatMessageLogEntry[] = []
    const events: Array<{ type: string }> = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(
          estimateMessagesForContext([current, ...tailPair])
        )
      },
      loadMessageLog: async () => [],
      appendMessageLog: async (entries: ChatMessageLogEntry[]) => {
        appended.push(...entries)
      },
      chatText: async (request: { system: string; user: string }) => {
        prompts.push({ system: request.system, user: request.user })
        return '## 目标\n不应调用'
      },
      checkCancelled: () => undefined,
      sendEvent: (event: { type: string }) => {
        events.push(event)
      }
    } as AiRunContext
    const cache = createHumanRuntimeCache()
    const beforeMessages = [earlierUser, ...earlierPair, current, ...tailPair]
    cache.messages = beforeMessages
    cache.currentUserLogAppended = true
    const node = createContextCompactionNode({ ctx, cache })

    await expect(
      node(
        createInitialHumanState({
          taskId: 'task-no-bookmark',
          userInput: 'continue the task'
        })
      )
    ).rejects.toMatchObject({
      name: 'AiRunFailure',
      failureCode: 'internal_error',
      rawMessage: 'compaction_bookmark_unresolved'
    })

    expect(prompts).toHaveLength(0)
    expect(appended).toHaveLength(0)
    expect(events.some((event) => event.type === 'context_compaction_started')).toBe(false)
    expect(cache.messages).toEqual(beforeMessages)
  })

  it('calls history then turn-prefix prompts on a mid-turn split and keeps checkpoint in conversation', async () => {
    const checkpoint = createCompactedBrainUserMessage(
      wrapCompactionCheckpointContent('## 目标\n写周报')
    )
    const older = new HumanMessage('old task')
    const olderPair = [
      new AIMessage({
        content: 'old work',
        tool_calls: [{ id: '0', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'old result', tool_call_id: '0' })
    ]
    const user = new HumanMessage('u'.repeat(80))
    const middle = [
      new AIMessage({
        content: 'm'.repeat(8000),
        tool_calls: [{ id: '1', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'n'.repeat(8000), tool_call_id: '1' })
    ]
    const lastPair = [
      new AIMessage({
        content: 'b'.repeat(400),
        tool_calls: [{ id: '2', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'c'.repeat(400), tool_call_id: '2' })
    ]
    const prompts: Array<{ system: string; user: string }> = []
    const appended: ChatMessageLogEntry[] = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(estimateMessagesForContext(lastPair))
      },
      loadMessageLog: async () => [
        logRecord(1, {
          kind: 'annotation',
          eventType: 'compaction_checkpoint',
          payload: {
            compactBlockId: 'old',
            coveredThroughSeq: 1,
            sourceMessageCount: 2,
            summary: '## 目标\n写周报'
          }
        }),
        logRecord(2, {
          kind: 'user',
          content: 'old task',
          context: { selectedReferences: [], attachments: [] }
        }),
        logRecord(3, {
          kind: 'user',
          content: 'u'.repeat(80),
          context: { selectedReferences: [], attachments: [] }
        })
      ],
      appendMessageLog: async (entries) => {
        appended.push(...entries)
      },
      chatText: async (request) => {
        prompts.push({ system: request.system, user: request.user })
        return request.user.includes('原始请求') ? '前半轮摘要' : '历史摘要'
      },
      checkCancelled: () => undefined,
      sendEvent: () => undefined
    } as AiRunContext
    const cache = createHumanRuntimeCache()
    cache.messages = [checkpoint, older, ...olderPair, user, ...middle, ...lastPair]
    const node = createContextCompactionNode({ ctx, cache })
    await node(
      createInitialHumanState({
        taskId: 'task-split',
        userInput: 'continue'
      })
    )

    expect(prompts).toHaveLength(2)
    expect(prompts[0]?.user).not.toContain('<previous-summary>')
    expect(prompts[0]?.user).toContain('compacted into the following summary')
    expect(prompts[0]?.user).toContain('## 目标\n写周报')
    expect(prompts[1]?.user).toContain('## 原始请求')
    expect(prompts[1]?.user).not.toContain('<previous-summary>')
    expect(appended[0]?.kind).toBe('annotation')
    if (appended[0]?.kind === 'annotation' && appended[0].eventType === 'compaction_checkpoint') {
      expect(appended[0].payload.summary).toContain('历史摘要')
      expect(appended[0].payload.summary).toContain('**Turn Context (split turn):**')
      expect(appended[0].payload.summary).toContain('前半轮摘要')
    }
  })
})
