import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import { buildCompactedMessages } from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createContext = (): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-compaction-shape',
    sessionId: 'session-compaction-shape',
    runStartedAt: Date.now(),
    preference: 'default',
    workspace: {
      workspaceId: 'workspace-1',
      workspaceName: 'workspace-1',
      rootPath: '/tmp/workspace-1'
    },
    referenceScope: {
      workspace: {
        workspaceId: 'workspace-1',
        workspaceName: 'workspace-1',
        rootPath: '/tmp/workspace-1'
      },
      selectedReferences: [],
      attachments: []
    }
  }) as AiRunContext

describe('ai human context compaction message shape', () => {
  it('rebuilds system, one current user, and the final AI/tool tail', () => {
    const state = createInitialHumanState({
      taskId: 'task-compaction-shape',
      userInput: '继续完成任务'
    })
    state.memory.plan = [{ title: '交付结果', status: 'todo' }]
    const tail = [
      new AIMessage({
        content: '准备交付',
        tool_calls: [{ id: 'call-tail', name: 'text_file_edit', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: '写入成功', tool_call_id: 'call-tail' })
    ]

    const messages = buildCompactedMessages({
      ctx: createContext(),
      state,
      summary: '任务锚点：继续完成任务',
      tail,
      existingMessages: []
    })

    expect(messages.map((message) => message.getType())).toEqual(['system', 'human', 'ai', 'tool'])
    expect(messages.filter((message) => message.getType() === 'human')).toHaveLength(1)
    const user = String(messages[1]?.content)
    expect(user).toContain('<compacted_history>')
    expect(user).toContain('任务锚点：继续完成任务')
    expect(user.indexOf('</reference_scope>')).toBeLessThan(user.indexOf('<current_time>'))
    expect(user.indexOf('</current_time>')).toBeLessThan(user.indexOf('<compacted_history>'))
    expect(user.indexOf('</compacted_history>')).toBeLessThan(user.indexOf('<active_state>'))
    expect(user).toContain('计划进度：[todo] 交付结果')
    expect((messages[2] as AIMessage).tool_calls?.[0]?.id).toBe('call-tail')
    expect((messages[3] as ToolMessage).tool_call_id).toBe('call-tail')
  })
})
