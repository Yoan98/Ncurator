import { describe, expect, it } from 'vitest'
import { createContextCompactionNode } from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import {
  buildHistoryCompactionPrompt,
  buildTurnPrefixCompactionPrompt,
  joinSplitCompactionSummary,
  wrapCompactionCheckpointContent
} from '../../../../src/main/services/ai/human/prompts/compaction'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type {
  AiRunEvent,
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import {
  isCompactedBrainUserMessage,
  isCurrentBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  CONTEXT_COMPACTION_TAIL_RATIO,
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  resolveCompactionTailTokens
} from '../../../../src/main/services/ai/human/constants'
import { messagesFromLogEntries } from '../../../../src/main/services/ai/human/memory/conversationLogMessages'
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

const userEntry = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input: content,
  context: { selectedReferences: [], attachments: [] }
})

const assistantEntry = (id: string, content: string): ChatMessageLogEntry => ({
  kind: 'assistant',
  content,
  toolCalls: [{ id, name: 'docx_read_nodes', args: {} }]
})

const toolEntry = (id: string, content: string): ChatMessageLogEntry => ({
  kind: 'tool',
  toolCallId: id,
  toolName: 'docx_read_nodes',
  ok: true,
  content
})

const costOf = (records: ChatMessageLogRecord[]): number =>
  estimateMessagesForContext(messagesFromLogEntries(records.map((record) => record.entry)))

const compactionEvents = (events: readonly AiRunEvent[]) => ({
  started: events.filter((event) => event.type === 'context_compaction_started'),
  completed: events.filter((event) => event.type === 'context_compaction_completed')
})

describe('ai human context compaction node', () => {
  it('writes a checkpoint then re-projects system, compact user, and retained tail', async () => {
    const tail = [
      logRecord(4, userEntry('continue the task')),
      logRecord(5, assistantEntry('2', 'current work')),
      logRecord(6, toolEntry('2', 'current result'))
    ]
    const records = [
      logRecord(1, userEntry('old task')),
      logRecord(2, assistantEntry('1', 'old work')),
      logRecord(3, toolEntry('1', 'old result')),
      ...tail
    ]
    const appended: ChatMessageLogEntry[] = []
    const prompts: Array<{ system: string; user: string }> = []
    const events: AiRunEvent[] = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(costOf(tail))
      },
      loadMessageLog: async () => records,
      appendMessageLog: async (entries) => {
        appended.push(...entries)
      },
      chatText: async (request) => {
        prompts.push({ system: request.system, user: request.user })
        return '## 目标\n继续交付'
      },
      checkCancelled: () => undefined,
      sendEvent: (event: AiRunEvent) => {
        events.push(event)
      }
    } as AiRunContext
    const cache = createHumanRuntimeCache()
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
      expect(appended[0].payload.throughSeq).toBe(3)
    }
    expect(cache.messages?.map((message) => message.getType())).toEqual([
      'system',
      'human',
      'human',
      'ai',
      'tool'
    ])
    expect(isCompactedBrainUserMessage(cache.messages![1]!)).toBe(true)
    expect(String(cache.messages![1]?.content)).toBe(wrapCompactionCheckpointContent('## 目标\n继续交付'))
    expect(String(cache.messages![2]?.content)).toBe('continue the task')
    expect(isCurrentBrainUserMessage(cache.messages![2]!)).toBe(false)
    expect(cache.messages?.filter(isCurrentBrainUserMessage)).toHaveLength(0)
    expect(next.execution.stage).toBe('context_budget')
    const { started, completed } = compactionEvents(events)
    expect(started).toHaveLength(1)
    expect(completed).toHaveLength(1)
    expect(started[0]).toMatchObject({
      throughSeq: 3,
      firstKeptSeq: 4,
      historyFloorSeq: -1,
      historyFloorKind: 'none',
      isSplitTurn: false,
      foldedCount: 3,
      tailCount: 3
    })
    expect(completed[0]).toMatchObject({
      throughSeq: 3,
      firstKeptSeq: 4,
      historyFloorKind: 'none',
      isSplitTurn: false,
      foldedCount: 3,
      tailCount: 3
    })
  })

  it('sends Discard User into the compaction conversation as a user block', async () => {
    const tail = [
      logRecord(5, userEntry('continue the task')),
      logRecord(6, assistantEntry('2', 'current work')),
      logRecord(7, toolEntry('2', 'current result'))
    ]
    const records = [
      logRecord(1, {
        kind: 'annotation',
        eventType: 'discard_checkpoint',
        payload: {
          throughSeq: 1,
          conversationHistory: '用户：调研SECRET\n交付：已记下调研'
        }
      }),
      logRecord(2, userEntry('old task')),
      logRecord(3, assistantEntry('1', 'old work')),
      logRecord(4, toolEntry('1', 'old result')),
      ...tail
    ]
    const appended: ChatMessageLogEntry[] = []
    const prompts: Array<{ system: string; user: string }> = []
    const events: AiRunEvent[] = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(costOf(tail))
      },
      loadMessageLog: async () => records,
      appendMessageLog: async (entries) => {
        appended.push(...entries)
      },
      chatText: async (request) => {
        prompts.push({ system: request.system, user: request.user })
        return '## 关键上下文\n调研SECRET'
      },
      checkCancelled: () => undefined,
      sendEvent: (event: AiRunEvent) => {
        events.push(event)
      }
    } as AiRunContext
    const cache = createHumanRuntimeCache()
    cache.currentUserLogAppended = true
    const node = createContextCompactionNode({ ctx, cache })
    await node(
      createInitialHumanState({
        taskId: 'task-compact-discard',
        userInput: 'continue the task'
      })
    )

    expect(prompts).toHaveLength(1)
    expect(prompts[0]?.user).toContain('<conversation>')
    expect(prompts[0]?.user).toContain('[user]')
    expect(prompts[0]?.user).toContain('以下是最近的会话内容')
    expect(prompts[0]?.user).toContain('调研SECRET')
    expect(appended[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'compaction_checkpoint'
    })
    expect(isCompactedBrainUserMessage(cache.messages![1]!)).toBe(true)
    expect(String(cache.messages![1]?.content)).toContain('调研SECRET')
    expect(cache.messages?.some((message) => String(message.content).includes('以下是最近的会话内容'))).toBe(
      false
    )
    expect(compactionEvents(events).completed[0]).toMatchObject({
      throughSeq: 4,
      firstKeptSeq: 5,
      historyFloorSeq: 1,
      historyFloorKind: 'discard',
      isSplitTurn: false,
      foldedCount: 3,
      tailCount: 3
    })
  })

  it('returns to budget when the log has nothing compressible', async () => {
    const prompts: Array<{ system: string; user: string }> = []
    const appended: ChatMessageLogEntry[] = []
    const events: Array<{ type: string }> = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(32)
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
    cache.currentUserLogAppended = true
    const node = createContextCompactionNode({ ctx, cache })
    const next = await node(
      createInitialHumanState({
        taskId: 'task-no-bookmark',
        userInput: 'continue the task'
      })
    )

    expect(next.execution.stage).toBe('context_budget')
    expect(prompts).toHaveLength(0)
    expect(appended).toHaveLength(0)
    expect(events.some((event) => event.type === 'context_compaction_started')).toBe(false)
    expect(cache.messages).toBeUndefined()
  })

  it('calls history then turn-prefix prompts on a mid-turn split and keeps checkpoint in conversation', async () => {
    const lastPair = [
      logRecord(8, assistantEntry('2', 'b'.repeat(400))),
      logRecord(9, toolEntry('2', 'c'.repeat(400)))
    ]
    const records = [
      logRecord(1, {
        kind: 'annotation',
        eventType: 'compaction_checkpoint',
        payload: {
          compactBlockId: 'old',
          throughSeq: 1,
          sourceMessageCount: 2,
          summary: '## 目标\n写周报'
        }
      }),
      logRecord(2, userEntry('old task')),
      logRecord(3, assistantEntry('0', 'old work')),
      logRecord(4, toolEntry('0', 'old result')),
      logRecord(5, userEntry('u'.repeat(80))),
      logRecord(6, assistantEntry('1', 'm'.repeat(8000))),
      logRecord(7, toolEntry('1', 'n'.repeat(8000))),
      ...lastPair
    ]
    const prompts: Array<{ system: string; user: string }> = []
    const appended: ChatMessageLogEntry[] = []
    const events: AiRunEvent[] = []
    const ctx = {
      ...createContext(),
      humanRuntimeOverrides: {
        modelContextWindowTokens: contextWindowForTail(costOf(lastPair))
      },
      loadMessageLog: async () => records,
      appendMessageLog: async (entries) => {
        appended.push(...entries)
      },
      chatText: async (request) => {
        prompts.push({ system: request.system, user: request.user })
        return request.user.includes('原始请求') ? '前半轮摘要' : '历史摘要'
      },
      checkCancelled: () => undefined,
      sendEvent: (event: AiRunEvent) => {
        events.push(event)
      }
    } as AiRunContext
    const cache = createHumanRuntimeCache()
    cache.currentUserLogAppended = true
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
      expect(appended[0].payload.throughSeq).toBe(7)
    }
    expect(cache.messages?.map((message) => message.getType())).toEqual(['system', 'human', 'ai', 'tool'])
    expect(isCompactedBrainUserMessage(cache.messages![1]!)).toBe(true)
    expect(cache.messages?.some((message) => String(message.content) === 'u'.repeat(80))).toBe(false)
    expect(cache.messages?.filter(isCurrentBrainUserMessage)).toHaveLength(0)
    expect(compactionEvents(events).completed[0]).toMatchObject({
      throughSeq: 7,
      firstKeptSeq: 8,
      historyFloorSeq: 1,
      historyFloorKind: 'compaction',
      isSplitTurn: true,
      foldedCount: 6,
      tailCount: 2
    })
  })
})
