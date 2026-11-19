import { describe, expect, it } from 'vitest'
import { presentRunFailureText } from '../../../../src/shared/llmFailureText'
import type { AiRunEvent } from '../../../../src/shared/types'
import { reduceAssistantProcessGroups } from '../../../harness/core/assistantProcessGroups'

const retryStarted = (
  groupId: string,
  attempt: number,
  createdAt: number,
  connection = false
): AiRunEvent => ({
  type: 'assistant_process_group_started',
  runId: 'run-1',
  groupId,
  kind: 'retry',
  display: {
    kind: 'retry',
    attempt,
    maxAttempts: 5,
    message: connection ? '回答未完整接收。本次未计费。' : '429',
    connection
  },
  createdAt
})

describe('assistant process retry groups', () => {
  it('keeps a single retry row when attempts and later LLM calls reuse the run', () => {
    const first = reduceAssistantProcessGroups([], retryStarted('run-1:llm-retry:call-a', 1, 10))
    const second = reduceAssistantProcessGroups(first, retryStarted('run-1:llm-retry:call-a', 2, 20))
    const nextCall = reduceAssistantProcessGroups(
      second,
      retryStarted('run-1:llm-retry:call-b', 1, 30)
    )
    const retryGroups = nextCall.filter((group) => group.kind === 'retry')
    expect(retryGroups).toHaveLength(1)
    expect(retryGroups[0].status).toBe('running')
    expect(retryGroups[0].createdAt).toBe(10)
    expect(retryGroups[0].id).toBe('run-1:llm-retry:call-a')
    expect(
      second.filter((group) => group.kind === 'retry')[0]?.runningText.map((segment) => segment.text).join('')
    ).toContain('2/5')
  })

  it('shows connection-specific copy and attempt count only for a connection issue', () => {
    const id = 'run-1:llm-retry'
    const connection = reduceAssistantProcessGroups([], retryStarted(id, 2, 10, true))
    expect(connection[0].runningText.map(item => item.text).join('')).toContain('连接不稳定，正在重试（2/5）')
    expect(connection[0].failedText.map(item => item.text).join('')).toContain('这次没完成，请重试（2/5）')
    const nonConnection = reduceAssistantProcessGroups(connection, retryStarted(id, 3, 20))
    expect(nonConnection[0].runningText.map(item => item.text).join('')).not.toContain('连接不稳定')
  })

  it('hides legacy billing copy without obscuring actual failure details', () => {
    expect(presentRunFailureText('上游连接中断，回答未完整接收。本次未计费。')).toBe('上游连接中断，回答未完整接收。')
    expect(presentRunFailureText('模型本次没有返回可用内容。本次已计费。')).toBe('模型本次没有返回可用内容。')
    expect(presentRunFailureText('计费状态待确认。')).toBe('')
    expect(presentRunFailureText('费用处理中')).toBe('请求处理中')
    expect(presentRunFailureText('馆长账户有未付费用，请充值后再试。')).toBe('请充值后再试。')
    expect(presentRunFailureText('余额不足，请充值或缩短本次上下文。')).toBe('余额不足，请充值或缩短本次上下文。')
  })

  it('dismisses the retry row after the call succeeds', () => {
    const running = reduceAssistantProcessGroups([], retryStarted('run-1:llm-retry', 2, 10))
    const completed = reduceAssistantProcessGroups(running, {
      type: 'assistant_process_group_completed',
      runId: 'run-1',
      groupId: 'run-1:llm-retry',
      completedAt: 20
    })
    expect(completed.filter((group) => group.kind === 'retry')).toHaveLength(0)
    expect(completed.map((group) => group.kind)).not.toContain('retry')
  })

  it('keeps a failed retry row', () => {
    const running = reduceAssistantProcessGroups([], retryStarted('run-1:llm-retry', 5, 10))
    const failed = reduceAssistantProcessGroups(running, {
      type: 'assistant_process_group_failed',
      runId: 'run-1',
      groupId: 'run-1:llm-retry',
      failedAt: 20
    })
    const retryGroups = failed.filter((group) => group.kind === 'retry')
    expect(retryGroups).toHaveLength(1)
    expect(retryGroups[0].status).toBe('failed')
    expect(retryGroups[0].failedText.map((segment) => segment.text).join('')).toContain('重试失败')
  })
})
