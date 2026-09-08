import { AIMessage, ToolMessage } from '@langchain/core/messages'
import { describe, expect, it } from 'vitest'
import { buildCompactedMessages } from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import {
  buildHistoryCompactionPrompt,
  wrapCompactionCheckpointContent
} from '../../../../src/main/services/ai/human/prompts/compaction'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { createCurrentBrainUserMessage } from '../../../../src/main/services/ai/human/node/utils/messageTail'

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
  it('rebuilds system, a compaction user, and the retained original tail', () => {
    const current = createCurrentBrainUserMessage('<user_context>继续完成任务</user_context>')
    const tail = [
      current,
      new AIMessage({
        content: '正在写初稿',
        tool_calls: [{ id: '1', name: 'docx_read_nodes', args: {}, type: 'tool_call' }]
      }),
      new ToolMessage({ content: 'draft nodes', tool_call_id: '1' })
    ]
    const summary = '目标：\n准备交付\n约束：\n无\n进度：\n无\n下一步：\n无\n文件：\n无'

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
    expect(compactionUser).toContain('目标：')
    expect(compactionUser).not.toContain('<user_context>')
    expect(compactionUser).not.toContain('<memory>')
    expect(compactionUser).not.toContain('<active_state>')
  })
})

describe('ai human history compaction prompt', () => {
  it('uses folded conversation text and the five memory headings', () => {
    const prompt = buildHistoryCompactionPrompt({
      conversationText: '[user]\n填周报\n\n[ai] 已读上周'
    })
    expect(prompt.user).toContain('[user]')
    expect(prompt.user).toContain('填周报')
    expect(prompt.user).toContain('已读上周')
    expect(prompt.user).not.toContain('[round')
    expect(prompt.user).not.toContain('<current>')
    expect(prompt.user).not.toContain('<earlier>')
    expect(prompt.system).toContain('目标：')
    expect(prompt.system).toContain('约束：')
    expect(prompt.system).toContain('进度：')
    expect(prompt.system).toContain('下一步：')
    expect(prompt.system).toContain('文件：')
    expect(prompt.system).not.toContain('记忆时间线：')
    expect(prompt.system).not.toContain('历史事实：')
    expect(prompt.system).toContain('整份重写')
  })
})
