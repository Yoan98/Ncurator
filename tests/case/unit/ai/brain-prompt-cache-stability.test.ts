import { SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import { projectBrainMessagesFromLog } from '../../../../src/main/services/ai/human/memory/brainMessageProjection'
import { isCurrentBrainUserMessage } from '../../../../src/main/services/ai/human/node/utils/messageTail'
import {
  buildBrainSystemPrompt,
  buildBrainUserMessage
} from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import type { ChatMessageLogRecord } from '../../../../src/shared/types'

const createFakeCtx = (runStartedAt = 0): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-cache-stability',
    partnerId: 'partner-cache-stability',
    partnerName: '测试伙伴',
    workspaceRoots: ['/tmp/workspace'],
    runStartedAt,
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
    }
  }) as AiRunContext

const buildStateWithPlan = () => {
  const state = createInitialHumanState({
    taskId: 'task-cache-stability',
    userInput: '继续处理资料'
  })
  state.memory.plan = [{ title: '读取当前目录', status: 'done' }]
  state.skills.learnedSkillIds = ['docx-read']
  return state
}

const messageSignature = (messages: BaseMessage[]): string =>
  messages
    .map((message) => {
      const type = message.getType()
      const marker =
        type === 'human' && isCurrentBrainUserMessage(message) ? ':current' : ':historical'
      return `${type}${marker}:${String(message.content)}`
    })
    .join('\n---\n')

const prefixBeforeCurrentUser = (messages: BaseMessage[]): string => {
  const currentIndex = messages.findIndex((message) => isCurrentBrainUserMessage(message))
  if (currentIndex < 0) return messageSignature(messages)
  return messageSignature(messages.slice(0, currentIndex))
}

const FROZEN_HISTORICAL_USER = `<user_context>
  <task_goal>
请整理过拟合概念。
  </task_goal>

  <preference>
无
  </preference>

  <reference_scope>
无
  </reference_scope>
  <current_time>
- current_time.timezone：UTC
- current_time.local_iso：1970-01-01T00:00:00+00:00
  </current_time>
</user_context>`

const buildResumeBrainMessages = (input: {
  records: ChatMessageLogRecord[]
  state: ReturnType<typeof createInitialHumanState>
  runStartedAt?: number
}): BaseMessage[] => {
  const ctx = createFakeCtx(input.runStartedAt)
  const brainProjection = projectBrainMessagesFromLog({
    records: input.records,
    ctx,
    state: input.state,
    memoryText: input.state.memory.compactions.at(-1)?.summary
  })
  return [new SystemMessage(buildBrainSystemPrompt({ ctx })), ...brainProjection.messages]
}

const resumeRecords: ChatMessageLogRecord[] = [
  {
    id: 'log-1',
    partnerId: 'partner-cache-stability',
    runId: 'run-1',
    seq: 1,
    createdAt: 1,
    entry: {
      kind: 'user',
      content: '请整理过拟合概念。',
      context: {
        selectedReferences: [],
        attachments: []
      }
    }
  },
  {
    id: 'log-1-snapshot',
    partnerId: 'partner-cache-stability',
    runId: 'run-1',
    seq: 2,
    createdAt: 2,
    entry: {
      kind: 'annotation',
      eventType: 'brain_user_snapshot',
      payload: { text: FROZEN_HISTORICAL_USER }
    }
  },
  {
    id: 'log-2',
    partnerId: 'partner-cache-stability',
    runId: 'run-1',
    seq: 3,
    createdAt: 3,
    entry: {
      kind: 'assistant',
      content: '先检索资料',
      toolCalls: [{ id: 'call-1', name: 'grep_search', args: { query: '过拟合' } }]
    }
  },
  {
    id: 'log-3',
    partnerId: 'partner-cache-stability',
    runId: 'run-1',
    seq: 4,
    createdAt: 4,
    entry: {
      kind: 'tool',
      toolCallId: 'call-1',
      toolName: 'grep_search',
      ok: true,
      content: '命中 2 条结果'
    }
  },
  {
    id: 'log-4',
    partnerId: 'partner-cache-stability',
    runId: 'run-1',
    seq: 5,
    createdAt: 5,
    entry: {
      kind: 'assistant',
      content: '已整理过拟合：概念、原因、处理方式。',
      toolCalls: []
    }
  }
]

describe('ai unit brain prompt cache stability', () => {
  it('renders byte-identical output for the same state', () => {
    const state = buildStateWithPlan()
    const ctx = createFakeCtx()

    const firstSystem = buildBrainSystemPrompt({ ctx })
    const secondSystem = buildBrainSystemPrompt({ ctx })
    const firstUser = buildBrainUserMessage({ state, ctx })
    const secondUser = buildBrainUserMessage({ state, ctx })

    expect(secondSystem).toBe(firstSystem)
    expect(secondUser).toBe(firstUser)
  })

  it('keeps the system prompt static across tasks and run start times', () => {
    const stateA = createInitialHumanState({ taskId: 'task-a', userInput: '任务 A' })
    const stateB = createInitialHumanState({ taskId: 'task-b', userInput: '任务 B' })
    const ctxA = createFakeCtx(1_700_000_000_000)
    const ctxB = createFakeCtx(1_700_000_100_000)

    const aSystem = buildBrainSystemPrompt({ ctx: ctxA })
    const bSystem = buildBrainSystemPrompt({ ctx: ctxB })

    expect(aSystem).toBe(bSystem)
    expect(aSystem).not.toContain('current_time.local_iso')

    const aUser = buildBrainUserMessage({ state: stateA, ctx: ctxA })
    const bUser = buildBrainUserMessage({ state: stateB, ctx: ctxB })
    expect(aUser).not.toBe(bUser)
    expect(aUser).toContain('任务 A')
    expect(bUser).toContain('任务 B')
    expect(aUser).toContain('<current_time>')
    expect(bUser).toContain('<current_time>')
  })

  it('keeps system static across tasks and embeds platform and runtime paths', () => {
    const ctx = createFakeCtx()

    const system = buildBrainSystemPrompt({ ctx })

    expect(system).toContain('platform：macos')
    expect(system).toContain('runtime_paths.assets：')
    expect(system).toContain('runtime_paths.scripts：')
    expect(system).not.toContain('current_time')
  })

  it('rebuilds resume messages from frozen historical build user and current build user', () => {
    const state = createInitialHumanState({
      taskId: 'run-2',
      userInput: '保留刚才的过拟合信息，再补充反走样。'
    })

    const messages = buildResumeBrainMessages({ records: resumeRecords, state })
    const humanMessages = messages.filter((message) => message.getType() === 'human')

    expect(messages[0]?.getType()).toBe('system')
    expect(humanMessages).toHaveLength(2)
    expect(String(humanMessages[0]?.content)).toBe(FROZEN_HISTORICAL_USER)
    expect(String(humanMessages[0]?.content)).not.toContain('<active_state>')
    expect(String(humanMessages[1]?.content)).toContain('保留刚才的过拟合信息，再补充反走样。')
    expect(String(humanMessages[1]?.content)).toContain('<active_state>')
    expect(isCurrentBrainUserMessage(humanMessages[1] as BaseMessage)).toBe(true)
  })

  it('keeps resume prefix stable across run clocks while only the current build user changes', () => {
    const baseState = createInitialHumanState({
      taskId: 'run-2',
      userInput: '保留刚才的过拟合信息，再补充反走样。'
    })
    const stateWithPlan = {
      ...baseState,
      memory: {
        ...baseState.memory,
        plan: [{ title: '补充反走样', status: 'todo' }]
      }
    }

    const firstPass = buildResumeBrainMessages({
      records: resumeRecords,
      state: baseState,
      runStartedAt: 1_700_000_000_000
    })
    const secondPass = buildResumeBrainMessages({
      records: resumeRecords,
      state: baseState,
      runStartedAt: 1_700_000_000_000
    })
    const laterClock = buildResumeBrainMessages({
      records: resumeRecords,
      state: baseState,
      runStartedAt: 1_700_000_180_000
    })
    const withPlan = buildResumeBrainMessages({
      records: resumeRecords,
      state: stateWithPlan,
      runStartedAt: 1_700_000_000_000
    })

    expect(messageSignature(secondPass)).toBe(messageSignature(firstPass))
    expect(prefixBeforeCurrentUser(laterClock)).toBe(prefixBeforeCurrentUser(firstPass))
    expect(prefixBeforeCurrentUser(withPlan)).toBe(prefixBeforeCurrentUser(firstPass))
    expect(messageSignature(withPlan)).not.toBe(messageSignature(firstPass))
    expect(String(laterClock.find((message) => isCurrentBrainUserMessage(message))?.content)).not.toBe(
      String(firstPass.find((message) => isCurrentBrainUserMessage(message))?.content)
    )
  })

  it('rejects historical users without a frozen brain_user_snapshot', () => {
    const state = createInitialHumanState({
      taskId: 'run-2',
      userInput: '继续'
    })
    const recordsWithoutSnapshot = resumeRecords.filter(
      (record) =>
        !(
          record.entry.kind === 'annotation' &&
          record.entry.eventType === 'brain_user_snapshot'
        )
    )

    expect(() =>
      buildResumeBrainMessages({ records: recordsWithoutSnapshot, state })
    ).toThrow(/brain_user_snapshot/)
  })

  it('does not inject active_state on the first-run current build user', () => {
    const state = buildStateWithPlan()
    const messages = buildResumeBrainMessages({ records: [], state })
    const humanMessages = messages.filter((message) => message.getType() === 'human')
    expect(humanMessages).toHaveLength(1)
    expect(String(humanMessages[0]?.content)).not.toContain('<active_state>')
    expect(String(humanMessages[0]?.content)).toContain('继续处理资料')
  })
})
