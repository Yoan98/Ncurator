import { describe, expect, it } from 'vitest'
import { SystemMessage } from '@langchain/core/messages'
import type {
  ChatMessageLogEntry,
  ChatMessageLogRecord
} from '../../../../src/shared/types'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import {
  assembleConversationHistory,
  collectRunDigests,
  renderRunDigests
} from '../../../../src/main/services/ai/human/memory/runDigestCatalog'
import {
  projectMessageLogRecords,
  resolveHistoryFloor
} from '../../../../src/main/services/ai/human/memory/transcript'
import {
  isCompactedBrainUserMessage,
  isCurrentBrainUserMessage,
  isDiscardBrainUserMessage
} from '../../../../src/main/services/ai/human/node/utils/messageTail'
import {
  buildContextScopeLogEntries,
  decideContextScope
} from '../../../../src/main/services/ai/human/node/contextScopeDecision'
import {
  collectRunDigestFileChangePaths,
  normalizeRunDigestSummary
} from '../../../../src/main/services/ai/human/node/brainNode/runDigest'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import { buildBrainSystemPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
import { buildContextScopeDecisionPrompt } from '../../../../src/main/services/ai/human/prompts/contextScope'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS } from '../../../../src/main/services/ai/human/constants'

const user = (content: string, input = content): ChatMessageLogEntry => ({
  kind: 'user',
  content,
  input,
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

const digest = (summary: string, fileChangePaths: string[] = []): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'run_digest',
  payload: { summary, fileChangePaths }
})

const discardCheckpoint = (
  throughSeq: number,
  conversationHistory = ''
): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'discard_checkpoint',
  payload: { throughSeq, conversationHistory }
})

const checkpoint = (throughSeq: number, summary = '目标：已写周报'): ChatMessageLogEntry => ({
  kind: 'annotation',
  eventType: 'compaction_checkpoint',
  payload: {
    compactBlockId: 'checkpoint-1',
    throughSeq,
    sourceMessageCount: 2,
    summary
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
  {
    runId: 'run-1',
    entry: user(`<user_context>${'周报草稿。'.repeat(80)}</user_context>`, '按模板写本周周报，不要封面页。')
  },
  { runId: 'run-1', entry: assistant(`已写入周报。${'完成。'.repeat(80)}`) },
  {
    runId: 'run-1',
    entry: digest('按模板写本周周报，去掉了封面页', ['/Users/me/workspace/周报.docx'])
  }
])

describe('run digest list', () => {
  it('renders all digests as timestamped lines with changed files and no entry cap', () => {
    const many = records(
      Array.from({ length: 32 }, (_, index) => ({
        runId: `run-${index + 1}`,
        entry: digest(`任务 ${index + 1}`, index % 2 === 0 ? [`/tmp/file-${index + 1}.docx`] : []),
        createdAt: Date.UTC(2026, 2, 14, 8, 20) + index * 60_000
      }))
    )
    const entries = collectRunDigests(many)
    expect(entries).toHaveLength(32)
    expect(entries[0]?.summary).toBe('任务 1')
    const rendered = renderRunDigests(entries)
    expect(rendered.split('\n')).toHaveLength(32)
    expect(rendered).toContain('任务 1')
    expect(rendered).toContain('任务 32')
    expect(rendered).toContain('改动文件：/tmp/file-31.docx')
    expect(rendered).not.toMatch(/任务 2 \| .*改动文件/)
  })

  it('collects every digest in the given records', () => {
    const log = records([
      { runId: 'run-1', entry: user('old', '旧周报原文') },
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
    const digests = renderRunDigests(collectRunDigests(log))
    expect(digests).toContain('旧周报')
    expect(digests).toContain('改动文件：/Users/me/workspace/周报.docx')
    expect(digests).toContain('分析销售表')
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
      { runId: 'run-3', entry: discardCheckpoint(6, 'frozen-history') },
      { runId: 'run-3', entry: user('task-c') }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(6)
    expect(floor.includeCheckpoint).toBe(false)
    expect(floor.includeDiscard).toBe(true)
    expect(floor.compactionCheckpoint).toBeUndefined()
    expect(floor.discardCheckpoint?.throughSeq).toBe(6)
    expect(floor.discardCheckpoint?.conversationHistory).toBe('frozen-history')
  })

  it('keeps checkpoint when it is the later bookmark', () => {
    const log = records([
      { runId: 'run-1', entry: user('old') },
      { runId: 'run-1', entry: assistant('old-done') },
      { runId: 'run-2', entry: discardCheckpoint(2, 'old-history') },
      { runId: 'run-2', entry: user('kept') },
      { runId: 'run-2', entry: assistant('kept-done') },
      { runId: 'run-2', entry: checkpoint(5) }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(5)
    expect(floor.includeCheckpoint).toBe(true)
    expect(floor.includeDiscard).toBe(false)
    expect(floor.compactionCheckpoint?.throughSeq).toBe(5)
    expect(floor.discardCheckpoint).toBeUndefined()
  })

  it('ignores discard bookmarks from runs that never wrote conversation', () => {
    const log = records([
      { runId: 'run-1', entry: user('keep-me') },
      { runId: 'run-1', entry: assistant('kept') },
      { runId: 'run-2', entry: discardCheckpoint(2, 'should-ignore') }
    ])
    const floor = resolveHistoryFloor(log)
    expect(floor.historyFloorSeq).toBe(-1)
    expect(floor.discardCheckpoint).toBeUndefined()
  })
})

describe('brain message projection with context scope', () => {
  const ctx = createCtx()
  const state = createInitialHumanState({ taskId: 'task-new', userInput: '分析这个 Excel' })

  it('projects Discard User from originals and current user when needsHistory is false', () => {
    const log = records([
      { runId: 'run-1', entry: user('<user_context>secret-weekly-report</user_context>', 'secret-weekly-report') },
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
    expect(isDiscardBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(isCurrentBrainUserMessage(projection.messages[1]!)).toBe(true)
    const discardText = String(projection.messages[0]?.content)
    expect(discardText).toContain('以下是最近的会话内容')
    expect(discardText).toContain('用户：secret-weekly-report')
    expect(discardText).toContain('交付：week report written')
    expect(discardText).toContain('改动文件：/Users/me/workspace/周报.docx')
    expect(discardText).not.toContain('<task_catalog>')
    expect(discardText).not.toContain('按模板写本周周报，去掉了封面页')
    expect(String(projection.messages[1]?.content)).toContain('分析这个 Excel')
  })

  it('omits Discard User when nothing has been dropped from context', () => {
    const projection = projectBrainMessagesFromLog({
      records: bulkyHistory,
      ctx,
      state: createInitialHumanState({ taskId: 'task-continue', userInput: '把标题改一下' }),
      needsHistory: true
    })
    expect(projection.messages.some((message) => isDiscardBrainUserMessage(message))).toBe(false)
    expect(projection.messages.some((message) => isCompactedBrainUserMessage(message))).toBe(false)
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
  })

  it('keeps Compact User and omits Discard User for still-active history', () => {
    const log = records([
      { runId: 'run-1', entry: user('<user_context>fill weekly report</user_context>', 'fill weekly report') },
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
    expect(projection.messages.some((message) => isDiscardBrainUserMessage(message))).toBe(false)
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
    expect(String(projection.messages.map((message) => message.content).join('\n'))).not.toContain(
      'fill weekly report'
    )
  })

  it('reuses frozen conversationHistory before History User on the next true run', () => {
    const frozen = [
      '2026-03-14 16:20',
      '用户：secret-a',
      '交付：a-done'
    ].join('\n')
    const log = records([
      { runId: 'run-1', entry: user('<user_context>secret-a</user_context>', 'secret-a') },
      { runId: 'run-1', entry: assistant('a-done') },
      { runId: 'run-1', entry: digest('任务A') },
      { runId: 'run-2', entry: discardCheckpoint(3, frozen) },
      { runId: 'run-2', entry: user('<user_context>excel task</user_context>', 'excel task') },
      { runId: 'run-2', entry: assistant('excel done') },
      { runId: 'run-2', entry: digest('任务B', ['/tmp/sales.xlsx']) }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state: createInitialHumanState({ taskId: 'task-b2', userInput: '这个表再加一列' }),
      needsHistory: true
    })
    const texts = projection.messages.map((message) => String(message.content))
    expect(isDiscardBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(texts[0]).toBe(`以下是最近的会话内容\n\n${frozen}`)
    expect(texts[0]).not.toContain('<task_catalog>')
    expect(texts.join('\n')).toContain('excel task')
    expect(texts.join('\n')).not.toContain('任务A')
    expect(isCurrentBrainUserMessage(projection.messages.at(-1)!)).toBe(true)
  })

  it('synthesizes only Compact User after compaction overtakes discard', () => {
    const log = records([
      { runId: 'run-1', entry: user('调研内容SECRET', '调研内容SECRET') },
      { runId: 'run-1', entry: assistant('已记下调研') },
      { runId: 'run-1', entry: digest('完成调研') },
      { runId: 'run-2', entry: discardCheckpoint(3, '用户：调研内容SECRET\n交付：已记下调研') },
      { runId: 'run-2', entry: user('法国首都？', '法国首都？') },
      { runId: 'run-2', entry: assistant('巴黎') },
      { runId: 'run-2', entry: digest('回答法国首都') },
      {
        runId: 'run-3',
        entry: checkpoint(7, '## 关键上下文\n调研内容SECRET\n法国首都是巴黎')
      }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx,
      state: createInitialHumanState({ taskId: 'task-after-compact', userInput: '继续' }),
      needsHistory: true
    })
    expect(isCompactedBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(projection.messages.some((message) => isDiscardBrainUserMessage(message))).toBe(false)
    expect(String(projection.messages[0]?.content)).toContain('调研内容SECRET')
  })

  it('trims conversationHistory newest-first to 10% of the window', () => {
    const log = records([
      {
        runId: 'run-old',
        entry: user('OLD-RESEARCH-TOKEN', 'OLD-RESEARCH-TOKEN'),
        createdAt: Date.UTC(2026, 2, 14, 8, 0)
      },
      {
        runId: 'run-old',
        entry: assistant(`旧交付很长。${'调研正文。'.repeat(40)}`),
        createdAt: Date.UTC(2026, 2, 14, 8, 1)
      },
      {
        runId: 'run-old',
        entry: digest('旧调研', ['/tmp/old.md']),
        createdAt: Date.UTC(2026, 2, 14, 8, 2)
      },
      {
        runId: 'run-new',
        entry: user('NEW-SESSION', 'NEW-SESSION'),
        createdAt: Date.UTC(2026, 2, 14, 8, 3)
      },
      {
        runId: 'run-new',
        entry: assistant('短交付'),
        createdAt: Date.UTC(2026, 2, 14, 8, 4)
      },
      {
        runId: 'run-new',
        entry: digest('新会话'),
        createdAt: Date.UTC(2026, 2, 14, 8, 5)
      }
    ])
    const projection = projectBrainMessagesFromLog({
      records: log,
      ctx: createCtx({ windowTokens: 200 }),
      state,
      needsHistory: false
    })
    const discardText = String(projection.messages[0]?.content)
    expect(isDiscardBrainUserMessage(projection.messages[0]!)).toBe(true)
    expect(discardText).toContain('NEW-SESSION')
    expect(discardText).not.toContain('OLD-RESEARCH-TOKEN')
  })

  it('pairs each digest interval even when all sessions share one runId', () => {
    const log = records([
      { runId: 'shared', entry: user('记住 ALPHA', '记住 ALPHA') },
      { runId: 'shared', entry: assistant('已收到 ALPHA') },
      { runId: 'shared', entry: digest('记下关键词') },
      { runId: 'shared', entry: user('缩短确认', '缩短确认') },
      { runId: 'shared', entry: assistant('已记下') },
      { runId: 'shared', entry: digest('缩短确认') },
      { runId: 'shared', entry: user('法国首都', '法国首都') },
      { runId: 'shared', entry: assistant('巴黎') },
      { runId: 'shared', entry: digest('法国首都') },
      { runId: 'shared', entry: user('巴黎大区', '巴黎大区') },
      { runId: 'shared', entry: assistant('法兰西岛大区') },
      { runId: 'shared', entry: digest('巴黎大区') },
      { runId: 'shared', entry: user('未完成的一轮', '未完成的一轮') }
    ])
    const history = assembleConversationHistory(log, 10_000)
    const blocks = history.split('\n\n')
    expect(blocks).toHaveLength(4)
    expect(blocks[0]).toContain('用户：记住 ALPHA')
    expect(blocks[0]).toContain('交付：已收到 ALPHA')
    expect(blocks[0]).not.toContain('法兰西岛大区')
    expect(blocks[1]).toContain('用户：缩短确认')
    expect(blocks[1]).toContain('交付：已记下')
    expect(blocks[2]).toContain('用户：法国首都')
    expect(blocks[2]).toContain('交付：巴黎')
    expect(blocks[3]).toContain('用户：巴黎大区')
    expect(blocks[3]).toContain('交付：法兰西岛大区')
    expect(history).not.toContain('未完成的一轮')
  })

  it('does not pair an incomplete user with the next completed delivery', () => {
    const log = records([
      { runId: 'run-a', entry: user('失败的任务 A', '失败的任务 A') },
      { runId: 'run-a', entry: assistant('做到一半') },
      { runId: 'run-b', entry: user('成功的任务 B', '成功的任务 B') },
      { runId: 'run-b', entry: assistant('B 已完成') },
      { runId: 'run-b', entry: digest('完成任务 B') }
    ])
    const history = assembleConversationHistory(log, 10_000)
    expect(history).toContain('用户：成功的任务 B')
    expect(history).toContain('交付：B 已完成')
    expect(history).not.toContain('失败的任务 A')
    expect(history).not.toContain('做到一半')
  })

  it('keeps a completed run that sits before an incomplete run', () => {
    const log = records([
      { runId: 'run-0', entry: user('更早完成的任务', '更早完成的任务') },
      { runId: 'run-0', entry: assistant('更早那件已完成') },
      { runId: 'run-0', entry: digest('完成更早任务') },
      { runId: 'run-a', entry: user('失败的任务 A', '失败的任务 A') },
      { runId: 'run-a', entry: assistant('做到一半') },
      { runId: 'run-b', entry: user('成功的任务 B', '成功的任务 B') },
      { runId: 'run-b', entry: assistant('B 已完成') },
      { runId: 'run-b', entry: digest('完成任务 B') }
    ])
    const history = assembleConversationHistory(log, 10_000)
    const users = history
      .split('\n')
      .filter((line) => line.startsWith('用户：'))
      .map((line) => line.slice('用户：'.length))
    expect(users).toEqual(['更早完成的任务', '成功的任务 B'])
    expect(history).toContain('交付：更早那件已完成')
    expect(history).not.toContain('失败的任务 A')
    expect(history).not.toContain('做到一半')
  })

  it('uses the delivery assistant in a digest slice that also has tool calls', () => {
    const log = records([
      { runId: 'shared', entry: user('查一下周报', '查一下周报') },
      {
        runId: 'shared',
        entry: {
          kind: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-1', name: 'docx_read_outline', args: { path: '/tmp/a.docx' } }]
        }
      },
      {
        runId: 'shared',
        entry: {
          kind: 'tool',
          toolCallId: 'call-1',
          toolName: 'docx_read_outline',
          ok: true,
          content: 'outline'
        }
      },
      { runId: 'shared', entry: assistant('周报已读完') },
      { runId: 'shared', entry: digest('读周报', ['/tmp/a.docx']) }
    ])
    const history = assembleConversationHistory(log, 10_000)
    expect(history).toContain('用户：查一下周报')
    expect(history).toContain('交付：周报已读完')
    expect(history).toContain('改动文件：/tmp/a.docx')
    expect(history).not.toContain('outline')
  })
})

describe('context scope decision prompt', () => {
  it('asks about the current history and keeps the user message data-only', () => {
    const prompt = buildContextScopeDecisionPrompt({
      digestText: '2026-03-14 08:20 | 写周报 | 改动文件：/tmp/周报.docx',
      taskGoal: '把标题改一下'
    })
    expect(prompt.system).toContain('needsHistory')
    expect(prompt.system).toContain('reason')
    expect(prompt.system).toContain('digest')
    expect(prompt.system).not.toContain('目录')
    expect(prompt.system).not.toContain('上一轮')
    expect(prompt.system).not.toContain('最新')
    expect(prompt.user).toBe(
      [
        '<completed_run_digests>',
        '2026-03-14 08:20 | 写周报 | 改动文件：/tmp/周报.docx',
        '</completed_run_digests>',
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
      { runId: 'run-2', entry: discardCheckpoint(4, 'frozen') },
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
        output: { needsHistory: false, reason: '新诉求和近期周报无关' }
      })
    })
    const decision = await decideContextScope({
      ctx,
      state: createInitialHumanState({ taskId: 't', userInput: '分析这个 Excel' }),
      records: bulkyHistory
    })
    expect(decision).toMatchObject({
      needsHistory: false,
      basis: 'model_decision',
      reason: '新诉求和近期周报无关'
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

  it('writes discard_checkpoint with frozen conversationHistory only when history is not needed', () => {
    const log = bulkyHistory
    const keep = buildContextScopeLogEntries({
      decision: { needsHistory: true, basis: 'model_decision', budgetTokens: 90 },
      records: log,
      contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    })
    const fresh = buildContextScopeLogEntries({
      decision: {
        needsHistory: false,
        basis: 'model_decision',
        budgetTokens: 90,
        reason: '新诉求和近期周报无关'
      },
      records: log,
      contextWindowTokens: DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS
    })
    expect(keep).toHaveLength(1)
    expect(keep[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'context_scope_decided',
      payload: { needsHistory: true, basis: 'model_decision', budgetTokens: 90 }
    })
    expect(keep[0]?.kind === 'annotation' ? keep[0].payload : undefined).not.toHaveProperty(
      'reason'
    )
    expect(fresh).toHaveLength(2)
    expect(fresh[0]).toMatchObject({
      kind: 'annotation',
      eventType: 'context_scope_decided',
      payload: {
        needsHistory: false,
        basis: 'model_decision',
        reason: '新诉求和近期周报无关'
      }
    })
    expect(fresh[1]).toMatchObject({
      kind: 'annotation',
      eventType: 'discard_checkpoint',
      payload: { throughSeq: log[log.length - 1]?.seq }
    })
    const history =
      fresh[1]?.kind === 'annotation' && fresh[1].eventType === 'discard_checkpoint'
        ? fresh[1].payload.conversationHistory
        : ''
    expect(history).toContain('用户：按模板写本周周报，不要封面页。')
    expect(history).toContain('交付：已写入周报。')
    expect(history).toContain('改动文件：/Users/me/workspace/周报.docx')
    expect(history).not.toContain('<task_catalog>')
    expect(history).toBe(assembleConversationHistory(log, Math.floor(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS * 0.1)))
  })

  it('shows the judge only digests still above the history floor', async () => {
    let judgeUser = ''
    const ctx = createCtx({
      windowTokens: 200,
      chatStructured: async (request) => {
        judgeUser = request.user
        return { output: { needsHistory: false, reason: '只看到法国首都 digest' } }
      }
    })
    const log = records([
      { runId: 'run-1', entry: user('secret-weekly-report') },
      { runId: 'run-1', entry: assistant('week report written') },
      { runId: 'run-1', entry: digest('旧周报', ['/Users/me/workspace/周报.docx']) },
      { runId: 'run-2', entry: discardCheckpoint(3, 'frozen') },
      {
        runId: 'run-2',
        entry: user(`<user_context>${'法国首都问答。'.repeat(80)}</user_context>`, '法国的首都是哪里？')
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

  it('collects unique file change paths from delivery file changes', () => {
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
    expect(collectRunDigestFileChangePaths(state)).toEqual([
      '/Users/me/workspace/周报.docx',
      '/Users/me/workspace/备注.txt'
    ])
  })
})

describe('assembled fresh-topic messages', () => {
  it('is system plus Discard User plus current user', () => {
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
    expect(isDiscardBrainUserMessage(messages[1]!)).toBe(true)
    expect(isCurrentBrainUserMessage(messages[2]!)).toBe(true)
  })
})
