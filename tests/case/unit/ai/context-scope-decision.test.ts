import { describe, expect, it } from 'vitest'
import { SystemMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import {
  collectRunDigestCatalogEntries,
  renderRunDigestCatalog
} from '../../../../src/main/services/ai/human/memory/runDigestCatalog'
import {
  projectMessageLogRecords,
  resolveHistoryFloor
} from '../../../../src/main/services/ai/human/memory/transcript'
import {
  isCatalogBrainUserMessage,
  isCompactedBrainUserMessage,
  isCurrentBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import {
  buildContextScopeLogEntries,
  decideContextScope
} from '../../../../src/main/services/ai/human/node/contextScopeDecision'
import {
  collectRunDigestFilePaths,
  normalizeRunDigestSummary
} from '../../../../src/main/services/ai/human/node/brainNode/runDigest'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { buildBrainSystemPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { buildContextScopeDecisionPrompt } from '../../../../src/main/services/ai/human/prompts/contextScope'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { RUN_DIGEST_MAX_ENTRIES } from '../../../../src/main/services/ai/human/constants'

const user = (content: string): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  context: {
    selectedReferences: [],
    attachments: []
  }
})

const assistant = (content: string): ChatMessageLogEntry => ({
  kind: 'assistant',
  content,
  toolCalls: []
})

const records = (entries: Array<{ runId: string; entry: ChatMessageLogEntry; createdAt?: number }>) =>
  entries.map(
    ({ runId, entry, createdAt }, index): ChatMessageLogRecord => ({
      id: `log-${index + 1}`,
      partnerId: 'partner-1',
      runId,
      seq: index + 1,
      entry,
      createdAt: createdAt ?? Date.UTC(2026, 2, 14, 8, 20) + index
    })
  )

const digest = (summary: string, filePaths: string[] = []): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'run_digest',
  payload: { summary, filePaths }
})

const discardCheckpoint = (throughSeq: number): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'discard_checkpoint',
  payload: { throughSeq }
})

const checkpoint = (throughSeq: number): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'compaction_checkpoint',
  payload: {
    compactBlockId: 'checkpoint-1',
    throughSeq,
    sourceMessageCount: 2,
    summary: '目标：已写周报'
  }
})

const createCtx = (input?: {
  windowTokens?: number
  chatStructured?: AiRunContext['chatStructured']
}): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-new',
    partnerId: 'partner-1',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace'],
    runStartedAt: 0,
    preference: 'default',
    executionPermission: 'review',
    referenceScope: { selectedReferences: [], attachments: [] },
    humanRuntimeOverrides:
      typeof input?.windowTokens === 'number'
        ? { modelContextWindowTokens: input.windowTokens }
        : undefined,
    checkCancelled: () => undefined,
    chatStructured:
      input?.chatStructured ||
      (async () => {
        throw new Error('chatStructured should not be called')
      }),
    chatText: async () => {
      throw new Error('chatText should not be called')
    },
    loadMessageLog: async () => [],
    appendMessageLog: async () => undefined,
    sendEvent: () => undefined
  }) as AiRunContext

const bulkyHistory = records([
  { runId: 'run-1', entry: user(`<user_context>${'周报草稿。'.repeat(80)}</user_context>`) },
  { runId: 'run-1', entry: assistant(`已写入周报。${'完成。'.repeat(80)}`) },
  {
    runId: 'run-1',
    entry: digest('按模板写本周周报，去掉了封面页', ['/Users/me/workspace/周报.docx'])
  }
])

describe('run digest catalog', () => {
  it('renders recent digests as compact timestamped lines and caps at 30', () => {
    const many = records(
      Array.from({ length: RUN_DIGEST_MAX_ENTRIES + 2 }, (_, index) => ({
        runId: `run-${index + 1}`,
        entry: digest(`任务 ${index + 1}`, index % 2 === 0 ? [`/tmp/file-${index + 1}.docx`] : []),
        createdAt: Date.UTC(2026, 2, 14, 8, 20) + index * 60_000
      }))
    )
    const entries = collectRunDigestCatalogEntries(many)
    expect(entries).toHaveLength(RUN_DIGEST_MAX_ENTRIES)
    expect(entries[0]?.summary).toBe('任务 3')
    const rendered = renderRunDigestCatalog(entries)
    expect(rendered.split('\n')).toHaveLength(RUN_DIGEST_MAX_ENTRIES)
    expect(rendered).toContain('任务 32')
    expect(rendered).not.toContain('任务 1 |')
    expect(rendered).toContain('/tmp/file-31.docx')
  })

  it('does not apply history floor when collecting catalog entries', () => {
    const log = records([
      { runId: 'run-1', entry: user('old') },
      { runId: 'run-1', entry: assistant('old answer') },
      {
        runId: 'run-1',
        entry: digest('旧周报', ['/Users/me/workspace/周报.docx'])
      },
      { runId: 'run-2', entry: discardCheckpoint(3) },
      { runId: 'run-2', entry: user('new excel') },
      { runId: 'run-2', entry: assistant('excel done') },
      { runId: 'run-2', entry: digest('分析销售表', ['/Users/me/workspace/销售.xlsx']) }
    ])
    const catalog = renderRunDigestCatalog(collectRunDigestCatalogEntries(log))
    expect(catalog).toContain('旧周报')
    expect(catalog).toContain('/Users/me/workspace/周报.docx')
    expect(catalog).toContain('分析销售表')
  })
})

describe('history floor', () => {
  it('takes the larger of compaction and discard bookmarks and drops stale checkpoint', () => {
    const log = records([
      { runId: 'run-1', entry: user('secret-a') },
      { runId: 'run-1', entry: assistant('a-done') },
      { runId: 'run-1', entry: checkpoint(2) },
      { runId: 'run-2', entry: user('task-b') },
      { runId: 'run-2', entry: assistant('b-done') },
      { runId: 'run-2', entry: digest('任务B') },
      { runId: 'run-3', entry: discardCheckpoint(6) },
      { runId: 'run-3', entry: user('task-c') }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(6)
    expect(floor.includeCheckpoint).toBe(false)
    expect(floor.compactionCheckpoint).toBeUndefined()
    expect(floor.discardCheckpoint?.throughSeq).toBe(6)
  })

  it('keeps checkpoint when it is the later bookmark', () => {
    const log = records([
      { runId: 'run-1', entry: user('old') },
      { runId: 'run-1', entry: assistant('old-done') },
      { runId: 'run-2', entry: discardCheckpoint(2) },
      { runId: 'run-2', entry: user('kept') },
      { runId: 'run-2', entry: assistant('kept-done') },
      { runId: 'run-2', entry: checkpoint(5) }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(5)
    expect(floor.includeCheckpoint).toBe(true)
    expect(floor.compactionCheckpoint?.throughSeq).toBe(5)
  })

  it('ignores discard bookmarks from runs that never wrote conversation', () => {
    const log = records([
      { runId: 'run-1', entry: user('keep-me') },
      { runId: 'run-1', entry: assistant('kept') },
      { runId: 'run-2', entry: discardCheckpoint(2) }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(-1)
    expect(floor.discardCheckpoint).toBeUndefined()
  })
})

describe('brain message projection with context scope', () => {
  const ctx = createCtx()
  const state = createInitialHumanState({ taskId: 'task-new', userInput: '分析这个 Excel' })

  it('projects only catalog and current user when needsHistory is false', () => {
    const log = records([
      { runId: 'run-1', entry: user('secret-weekly-report') },
      { runId: 'run-1', entry: assistant('week report written') },
      {
        runId: 'run-1',
        entry: digest('按模板写本周周报，去掉了封面页', ['/Users/me/workspace/周报.docx'])
      }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state,
      needsHistory: false
    })
    expect(projection.messages).toHaveLength(2)
    expect(isCatalogBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(isCurrentBrainUserMessage(projection.messages[1]!)).toBe(true)
    expect(String(projection.messages[0]?.content)).toContain('<task_catalog>')
    expect(String(projection.messages[0]?.content)).toContain('/Users/me/workspace/周报.docx')
    expect(String(projection.messages.map((message) => message.content).join('\n'))).not.toContain(
      'secret-weekly-report'
    )
    expect(String(projection.messages[1]?.content)).toContain('分析这个 Excel')
  })

  it('omits the catalog when nothing has been dropped from context', () => {
    const projection = projectBrainMessagesFromLog({
      records: bulkyHistory,
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' }),
      needsHistory: true
    })
    // 原文全在上下文里，目录只会重复同一段对话。
    expect(projection.messages.some((message) => isCatalogBrainUserMessage(message))).toBe(false)
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
  })

  it('keeps the current history shape and omits the catalog for still-active digests', () => {
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>') },
      { runId: 'run-1', entry: assistant('week report written') },
      { runId: 'run-1', entry: digest('写周报') },
      { runId: 'run-1', entry: checkpoint(2) }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' }),
      needsHistory: true
    })
    expect(isCompactedBrainUserMessage(projection.messages[0]!)).toBe(true)
    // digest 的 seq 高于 checkpoint 下界，该任务仍在上下文里，不进目录。
    expect(projection.messages.some((message) => isCatalogBrainUserMessage(message))).toBe(false)
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
    expect(String(projection.messages.map((message) => message.content).join('\n'))).not.toContain(
      'fill weekly report'
    )
  })

  it('applies discard floor when continuing after a fresh topic', () => {
    const log = records([
      { runId: 'run-1', entry: user('secret-a') },
      { runId: 'run-1', entry: assistant('a-done') },
      { runId: 'run-1', entry: digest('任务A') },
      { runId: 'run-2', entry: discardCheckpoint(3) },
      { runId: 'run-2', entry: user('<user_context>excel task</user_context>') },
      { runId: 'run-2', entry: assistant('excel done') },
      { runId: 'run-2', entry: digest('任务B', ['/tmp/sales.xlsx']) }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state: createInitialHumanState({ taskId: 'task-b2', userInput: '这个表再加一列' }),
      needsHistory: true
    })
    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(text).not.toContain('secret-a')
    expect(text).toContain('excel task')
    // 已丢弃的任务 A 进目录（可按路径找回）；仍在上下文里的任务 B 不重复进目录。
    expect(isCatalogBrainUserMessage(projection.messages.at(-2)!)).toBe(true)
    expect(text).toContain('任务A')
    expect(text).not.toContain('任务B')
  })
})

describe('context scope decision prompt', () => {
  it('asks about the current history and keeps the user message data-only', () => {
    const prompt = buildContextScopeDecisionPrompt({
      catalogText: '2026-03-14 08:20 | 写周报 | /tmp/周报.docx',
      taskGoal: '把标题改一下'
    })
    expect(prompt.system).toContain('needsHistory')
    // 判定的对象是「当前这段历史」，不是「上一轮」或「最新那条目录」。
    expect(prompt.system).not.toContain('上一轮')
    expect(prompt.system).not.toContain('最新')
    expect(prompt.user).toBe(
      [
        '<completed_task_catalog>',
        '2026-03-14 08:20 | 写周报 | /tmp/周报.docx',
        '</completed_task_catalog>',
        '',
        '<new_task_goal>',
        '把标题改一下',
        '</new_task_goal>'
      ].join('\n')
    )
  })
})

describe('message log projection scan boundaries', () => {
  it('keeps learned skills even when conversation is below the floor', () => {
    const log = records([
      { runId: 'run-1', entry: user('learn docx') },
      {
        runId: 'run-1',
        entry: {
          kind: 'annotation',
          eventType: 'skill_state_updated',
          payload: { learnedSkillIds: ['docx-read'] }
        }
      },
      { runId: 'run-1', entry: assistant('done') },
      { runId: 'run-1', entry: digest('学会了 docx') },
      { runId: 'run-2', entry: discardCheckpoint(4) },
      { runId: 'run-2', entry: user('new') }
    ])
    const projection = projectMessageLogRecords(log)
    expect(projection.learnedSkillIds).toEqual(['docx-read'])
    expect(projection.historyFloorSeq).toBe(4)
    const text = projection.messages.map((message) => String(message.content)).join('\n')
    expect(text).not.toContain('learn docx')
  })
})

describe('context scope decision gates', () => {
  it('skips the judge on an empty partner log', async () => {
    let structuredCalls = 0
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async () => {
        structuredCalls += 1
        return { output: { needsHistory: false } }
      }
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '你好' }),
      records: []
    })
    expect(decision).toMatchObject({ needsHistory: true, basis: 'gate_below_threshold' })
    expect(structuredCalls).toBe(0)
  })

  it('keeps history when the previous run has no digest', async () => {
    let structuredCalls = 0
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async () => {
        structuredCalls += 1
        return { output: { needsHistory: false } }
      }
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '继续' }),
      records: records([
        { runId: 'run-1', entry: user('interrupted') },
        { runId: 'run-1', entry: assistant('half') }
      ])
    })
    expect(decision).toMatchObject({ needsHistory: true, basis: 'gate_incomplete_run' })
    expect(structuredCalls).toBe(0)
  })

  it('keeps history when the full projection is under the token threshold', async () => {
    let structuredCalls = 0
    const ctx = createCtx({
      windowTokens: 256_000,
      chatStructured: async () => {
        structuredCalls += 1
        return { output: { needsHistory: false } }
      }
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '下一个小问题' }),
      records: bulkyHistory
    })
    expect(decision.needsHistory).toBe(true)
    expect(decision.basis).toBe('gate_below_threshold')
    expect(structuredCalls).toBe(0)
  })

  it('asks the model when previous run completed and budget exceeds the threshold', async () => {
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async () => ({
        output: { needsHistory: false }
      })
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '分析这个 Excel' }),
      records: bulkyHistory
    })
    expect(decision).toMatchObject({
      needsHistory: false,
      basis: 'model_decision'
    })
    expect(decision.budgetTokens).toBeGreaterThan(40)
  })

  it('falls back to keeping history when the decision model fails', async () => {
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async () => {
        throw new Error('model down')
      }
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '分析这个 Excel' }),
      records: bulkyHistory
    })
    expect(decision).toMatchObject({ needsHistory: true, basis: 'fallback' })
  })

  it('writes discard_checkpoint only when history is not needed', () => {
    const log = bulkyHistory
    const keep = buildContextScopeLogEntries({
      decision: { needsHistory: true, basis: 'model_decision', budgetTokens: 90 },
      records: log
    })
    const fresh = buildContextScopeLogEntries({
      decision: { needsHistory: false, basis: 'model_decision', budgetTokens: 90 },
      records: log
    })
    expect(keep).toHaveLength(1)
    expect(keep[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'context_scope_decided',
      payload: { needsHistory: true, basis: 'model_decision', budgetTokens: 90 }
    })
    expect(fresh).toHaveLength(2)
    expect(fresh[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'context_scope_decided',
      payload: { needsHistory: false, basis: 'model_decision' }
    })
    expect(fresh[1]).toMatchObject({
      kind: 'annotation',
      eventType: 'discard_checkpoint',
      payload: { throughSeq: log[log.length - 1]?.seq }
    })
  })

  it('shows the judge only digests still above the history floor', async () => {
    let judgeUser = ''
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async (request) => {
        judgeUser = request.user
        return { output: { needsHistory: false } }
      }
    })
    const log = records([
      { runId: 'run-1', entry: user('secret-weekly-report') },
      { runId: 'run-1', entry: assistant('week report written') },
      { runId: 'run-1', entry: digest('旧周报', ['/Users/me/workspace/周报.docx']) },
      { runId: 'run-2', entry: discardCheckpoint(3) },
      {
        runId: 'run-2',
        entry: user(`<user_context>${'法国首都问答。'.repeat(80)}</user_context>`)
      },
      { runId: 'run-2', entry: assistant(`巴黎。${'完成。'.repeat(80)}`) },
      { runId: 'run-2', entry: digest('回答法国首都') }
    ])
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '刚才那个周报编号是多少？' }),
      records: log
    })
    expect(decision.basis).toBe('model_decision')
    expect(judgeUser).toContain('回答法国首都')
    expect(judgeUser).not.toContain('旧周报')
  })
})

describe('run digest helpers', () => {
  it('normalizes summary to a single clipped line', () => {
    expect(normalizeRunDigestSummary('  \n按模板写本周周报，去掉了封面页\n更多')).toBe(
      '按模板写本周周报，去掉了封面页'
    )
    expect(normalizeRunDigestSummary('')).toBe('')
  })

  it('collects unique file paths from delivery file changes', () => {
    const state = createInitialHumanState({ taskId: 't', userInput: '写周报' })
    state.execution.fileChanges = {
      changed_files: [
        {
          id: '1',
          fileName: '周报.docx',
          path: '/Users/me/workspace/周报.docx',
          capability: 'docx',
          operation: 'updated',
          changeCount: 1,
          insertCount: 1,
          deleteCount: 0,
          status: 'applied'
        },
        {
          id: '2',
          fileName: '周报.docx',
          path: '/Users/me/workspace/周报.docx',
          capability: 'docx',
          operation: 'updated',
          changeCount: 1,
          insertCount: 0,
          deleteCount: 0,
          status: 'applied'
        },
        {
          id: '3',
          fileName: '备注.txt',
          path: '/Users/me/workspace/备注.txt',
          capability: 'text_file',
          operation: 'created',
          changeCount: 1,
          insertCount: 1,
          deleteCount: 0,
          status: 'applied'
        }
      ]
    }
    expect(collectRunDigestFilePaths(state)).toEqual([
      '/Users/me/workspace/周报.docx',
      '/Users/me/workspace/备注.txt'
    ])
  })
})

describe('assembled fresh-topic messages', () => {
  it('is system plus catalog plus current user', () => {
    const ctx = createCtx()
    const state = createInitialHumanState({ taskId: 't', userInput: '分析 Excel' })
    const projection = projectBrainMessagesFromLog({
      records: bulkyHistory,
      ctx,
      state,
      needsHistory: false
    })
    const messages = [new SystemMessage(buildBrainSystemPrompt({ ctx })), ...projection.messages]
    expect(messages.map((message) => message.getType())).toEqual(['system', 'human', 'human'])
    expect(isCatalogBrainUserMessage(messages[1]!)).toBe(true)
    expect(isCurrentBrainUserMessage(messages[2]!)).toBe(true)
  })
})
