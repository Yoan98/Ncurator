import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import { createContextBudgetNode } from '../../../../src/main/services/ai/human/node/contextBudgetNode'
import { createHumanRuntimeCache } from '../../../../src/main/services/ai/human/node/utils/runtimeCache'
import {
  createCurrentBrainUserMessage,
  createDiscardBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import {
  CONTEXT_COMPACTION_TRIGGER_RATIO,
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
} from '../../../../src/main/services/ai/human/constants'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { AiRunEvent, ChatMessageLogEntry, ChatMessageLogRecord } from '../../../../src/shared/types'
import { LlmInputTooLongError } from '../../../../src/main/services/ai/errors'

const DEFAULT_COMPACTION_TRIGGER_TOKENS = Math.floor(
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS * CONTEXT_COMPACTION_TRIGGER_RATIO
)

const createBaseContext = (events: AiRunEvent[]): AiRunContext =>
  ({
    runId: 'run-1',
    platform: 'macos',
    partnerId: 'partner-1',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace'],
    runStartedAt: 0,
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      workspace: {
        workspaceId: 'ws-1',
        workspaceName: 'Workspace',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: [],
      attachments: []
    },
    workspace: {
      workspaceId: 'ws-1',
      workspaceName: 'Workspace',
      rootPath: '/tmp/workspace'
    },
    checkCancelled: () => undefined,
    chatStructured: async () => {
      throw new Error('not used in context budget test')
    },
    chatText: async () => {
      throw new Error('not used in context budget test')
    },
    sendEvent: (event) => events.push(event),
    requestApprovalBatch: async () => ({ accepted: true, decisions: [] }),
    loadMessageLog: async () => [],
    appendMessageLog: async () => undefined,
    trackDocxOpen: () => undefined,
    trackDocxChanges: () => undefined,
    resolveDocxOpenTarget: async () => {
      throw new Error('not used in context budget test')
    },
    beginDocxApplyRun: () => undefined,
    applyDocxRunEdits: async () => [],
    discardDocxApplyRun: () => undefined,
    documentsStore: {} as AiRunContext['documentsStore'],
    embeddingService: {} as AiRunContext['embeddingService']
  }) satisfies AiRunContext

const budgetLogRecord = (seq: number, entry: ChatMessageLogEntry): ChatMessageLogRecord => ({
  id: `log-${seq}`,
  partnerId: 'partner-1',
  runId: 'run-1',
  seq,
  entry,
  createdAt: seq
})

describe('ai unit context budget node', () => {
  it('records continue decision with brain context budget snapshot', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '帮我确认当前任务进度。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    expect(nextState.execution.contextBudget).toMatchObject({
      basis: 'initial',
      budgetTokens: 0,
      contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
      compactionTriggerTokens: DEFAULT_COMPACTION_TRIGGER_TOKENS,
      hasCompressibleHistory: false,
      usageAvailable: true,
      evaluationId: expect.any(String)
    })
    const event = events.find((item) => item.type === 'context_budget_evaluated')
    expect(event).toMatchObject({
      type: 'context_budget_evaluated',
      runId: 'run-1',
      taskId: 'task-1',
      stage: 'human_brain',
      decision: 'continue',
      snapshot: nextState.execution.contextBudget
    })
  })

  it('records compact decision when over trigger and compressible history exists', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const state = createInitialHumanState({
      taskId: 'task-2',
      userInput: '请完成一个会触发压缩的长任务。'
    })
    cache.messages = [
      ...Array.from(
        { length: 6 },
        (_, index) => [
          new AIMessage({ content: `long message ${index} ${'x'.repeat(400)}` }),
          new ToolMessage({ content: `tool result ${index} ${'x'.repeat(400)}`, tool_call_id: `call-${index}` })
        ]
      ).flat(),
      new AIMessage({ content: 'previous brain turn' }),
      new HumanMessage({
        content: '请完成一个会触发压缩的长任务。',
        additional_kwargs: { ncurator_current_user: true }
      })
    ]
    const records: ChatMessageLogRecord[] = Array.from({ length: 6 }, (_, index) => [
      budgetLogRecord(index * 2 + 1, {
        kind: 'assistant',
        content: `long message ${index} ${'x'.repeat(400)}`,
        toolCalls: [{ id: `call-${index}`, name: 'docx_read_nodes', args: {} }]
      }),
      budgetLogRecord(index * 2 + 2, {
        kind: 'tool',
        toolCallId: `call-${index}`,
        toolName: 'docx_read_nodes',
        ok: true,
        content: `tool result ${index} ${'x'.repeat(400)}`
      })
    ]).flat()
    const appended: Array<{ kind: string; origin?: string }> = []
    const calls: string[] = []
    const ctxWithSmallWindow = {
      ...ctx,
      humanRuntimeOverrides: {
        modelContextWindowTokens: 600
      },
      loadMessageLog: async () => {
        calls.push('load')
        return [...records]
      },
      appendMessageLog: async (entries) => {
        calls.push('append')
        const maxSeq = records.reduce((max, record) => Math.max(max, record.seq), 0)
        entries.forEach((entry, index) => {
          records.push(
            budgetLogRecord(maxSeq + index + 1, entry)
          )
        })
        appended.push(...entries.map((entry) => ({ kind: entry.kind })))
      }
    } satisfies AiRunContext
    const smallWindowNode = createContextBudgetNode({
      ctx: ctxWithSmallWindow,
      cache
    })
    cache.lastBrainInputTokens = 500

    const nextState = await smallWindowNode(state)

    expect(calls[0]).toBe('append')
    expect(calls.at(-1)).toBe('load')
    expect(nextState.execution.stage).toBe('context_compaction')
    expect(appended).toEqual([{ kind: 'user' }])
    expect(cache.currentUserLogAppended).toBe(true)
    const event = events.find((item) => item.type === 'context_budget_evaluated')
    expect(event).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'compact',
      snapshot: {
        basis: 'usage_plus_delta',
        budgetTokens: expect.any(Number),
        hasCompressibleHistory: true,
        usageAvailable: true,
        lastBrainInputTokens: 500,
        deltaTokenEstimate: expect.any(Number),
        contextWindowTokens: 600,
        compactionTriggerTokens: 480
      }
    })
  })

  it('records continue decision with usage_unavailable basis when brain usage is missing', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    cache.lastBrainUsageUnavailable = true
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '请确认当前任务状态。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    const budgetEvent = events.find((item) => item.type === 'context_budget_evaluated')
    expect(budgetEvent).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'continue',
      snapshot: {
        basis: 'usage_unavailable',
        budgetTokens: 0,
        usageAvailable: true,
        hasCompressibleHistory: false,
        contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
      }
    })
  })

  it('does not compact when post-user process fits in the retain window', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const state = createInitialHumanState({
      taskId: 'task-retain-only',
      userInput: '请继续当前任务。'
    })
    cache.messages = [
      new HumanMessage({
        content: '请继续当前任务。',
        additional_kwargs: { ncurator_current_user: true }
      }),
      new AIMessage({ content: 'short step' }),
      new ToolMessage({ content: 'ok', tool_call_id: 'call-1' })
    ]
    cache.currentUserLogAppended = true
    const node = createContextBudgetNode({
      ctx: {
        ...ctx,
        humanRuntimeOverrides: { modelContextWindowTokens: 10_000 },
        loadMessageLog: async () => [
          budgetLogRecord(1, {
            kind: 'user',
            content: '请继续当前任务。',
            input: '请继续当前任务。',
            context: { selectedReferences: [], attachments: [] }
          }),
          budgetLogRecord(2, {
            kind: 'assistant',
            content: 'short step',
            toolCalls: []
          }),
          budgetLogRecord(3, {
            kind: 'tool',
            toolCallId: 'call-1',
            toolName: 'docx_read_nodes',
            ok: true,
            content: 'ok'
          })
        ]
      },
      cache
    })
    cache.lastBrainInputTokens = 9_000

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    expect(events.find((event) => event.type === 'context_budget_evaluated')).toMatchObject({
      decision: 'continue',
      snapshot: { hasCompressibleHistory: false }
    })
  })

  it('does not compact when only the current user is in the message array', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const state = createInitialHumanState({
      taskId: 'task-small-history',
      userInput: '请继续当前任务。'
    })
    cache.messages = [
      new HumanMessage({
        content: '请继续当前任务。',
        additional_kwargs: { ncurator_current_user: true }
      })
    ]
    cache.currentUserLogAppended = true
    const node = createContextBudgetNode({
      ctx: {
        ...ctx,
        humanRuntimeOverrides: { modelContextWindowTokens: 10_000 },
        loadMessageLog: async () => [
          budgetLogRecord(1, {
            kind: 'user',
            content: '请继续当前任务。',
            input: '请继续当前任务。',
            context: { selectedReferences: [], attachments: [] }
          })
        ]
      },
      cache
    })
    cache.lastBrainInputTokens = 9_000

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    expect(events.find((event) => event.type === 'context_budget_evaluated')).toMatchObject({
      decision: 'continue',
      snapshot: { hasCompressibleHistory: false }
    })
  })

  it('does not compact when folded history is only a Discard User', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    const state = createInitialHumanState({
      taskId: 'task-discard-only',
      userInput: '法国首都是哪里？'
    })
    const current = createCurrentBrainUserMessage('法国首都是哪里？')
    const discard = createDiscardBrainUserMessage('以下是最近的会话内容\n\n用户：调研SECRET')
    cache.messages = [discard, current]
    cache.currentUserLogAppended = true
    const node = createContextBudgetNode({
      ctx: {
        ...ctx,
        humanRuntimeOverrides: { modelContextWindowTokens: 10_000 },
        loadMessageLog: async () => [
          budgetLogRecord(1, {
            kind: 'annotation',
            eventType: 'discard_checkpoint',
            payload: {
              throughSeq: 1,
              conversationHistory: '用户：调研SECRET'
            }
          }),
          budgetLogRecord(2, {
            kind: 'user',
            content: '法国首都是哪里？',
            input: '法国首都是哪里？',
            context: { selectedReferences: [], attachments: [] }
          })
        ]
      },
      cache
    })
    cache.lastBrainInputTokens = 9_000

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    expect(events.find((event) => event.type === 'context_budget_evaluated')).toMatchObject({
      decision: 'continue',
      snapshot: { hasCompressibleHistory: false }
    })
  })

  it('records continue decision with post_compaction basis after compaction clears usage baseline', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    cache.postCompactionNeedsFreshBrainUsage = true
    const node = createContextBudgetNode({ ctx, cache })
    const state = createInitialHumanState({
      taskId: 'task-4',
      userInput: '继续推进压缩后的任务。'
    })

    const nextState = await node(state)

    expect(nextState.execution.stage).toBe('brain')
    const budgetEvent = events.find((item) => item.type === 'context_budget_evaluated')
    expect(budgetEvent).toMatchObject({
      type: 'context_budget_evaluated',
      decision: 'continue',
      snapshot: {
        basis: 'post_compaction',
        budgetTokens: 0,
        usageAvailable: true,
        contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
      }
    })
  })

  it('rejects a current user message larger than the model context window', async () => {
    const events: AiRunEvent[] = []
    const ctx = createBaseContext(events)
    const cache = createHumanRuntimeCache()
    cache.messages = [
      new HumanMessage({
        content: 'x'.repeat(10_000),
        additional_kwargs: { ncurator_current_user: true }
      })
    ]
    const node = createContextBudgetNode({
      ctx: { ...ctx, humanRuntimeOverrides: { modelContextWindowTokens: 100 } },
      cache
    })

    await expect(
      node(
        createInitialHumanState({
          taskId: 'task-input-too-long',
          userInput: 'x'.repeat(10_000)
        })
      )
    ).rejects.toBeInstanceOf(LlmInputTooLongError)
  })

  it('writes context_scope_decided and discard_checkpoint with the user in one batch', async () => {
    const events: AiRunEvent[] = []
    const appended: ChatMessageLogEntry[] = []
    const ctx = {
      ...createBaseContext(events),
      loadMessageLog: async () => [
        {
          id: 'log-1',
          partnerId: 'partner-1',
          runId: 'run-0',
          seq: 3,
          entry: {
            kind: 'user' as const,
            content: 'prev',
            input: 'prev',
            context: { selectedReferences: [], attachments: [] }
          },
          createdAt: 1
        }
      ],
      appendMessageLog: async (entries: ChatMessageLogEntry[]) => {
        appended.push(...entries)
      }
    }
    const cache = createHumanRuntimeCache()
    cache.contextScopeDecision = {
      needsHistory: false,
      basis: 'model_decision',
      budgetTokens: 90
    }
    cache.messages = [
      new HumanMessage({
        content: '<user_context>分析 Excel</user_context>',
        additional_kwargs: { ncurator_current_user: true }
      })
    ]
    const node = createContextBudgetNode({ ctx, cache })
    await node(
      createInitialHumanState({
        taskId: 'task-scope',
        userInput: '分析 Excel'
      })
    )
    expect(appended).toHaveLength(3)
    expect(appended[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'context_scope_decided',
      payload: {
        needsHistory: false,
        basis: 'model_decision'
      }
    })
    expect(appended[1]).toMatchObject({
      kind: 'annotation',
      eventType: 'discard_checkpoint',
      payload: { throughSeq: 3 }
    })
    expect(appended[2]).toMatchObject({
      kind: 'user',
      content: '<user_context>分析 Excel</user_context>',
      input: '分析 Excel'
    })
  })
})
