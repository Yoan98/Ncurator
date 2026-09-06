import { describe, expect, it } from 'vitest'
import { buildCompactedMessages } from '../../../../src/main/services/ai/human/node/contextCompactionNode'
import { buildHistoryCompactionPrompt } from '../../../../src/main/services/ai/human/prompts/compaction'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

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
  it('rebuilds only system and one current user with memory, without a process tail', () => {
    const state = createInitialHumanState({
      taskId: 'task-compaction-shape',
      userInput: '继续完成任务'
    })
    state.memory.plan = [{ title: '交付结果', status: 'todo' }]

    const messages = buildCompactedMessages({
      ctx: createContext(),
      state,
      summary: '当前交付：\n- 准备交付\n已确认事实：\n- 无\n已尝试但未解决：\n- 无\n历史事实：\n- 无'
    })

    expect(messages.map((message) => message.getType())).toEqual(['system', 'human'])
    expect(messages.filter((message) => message.getType() === 'human')).toHaveLength(1)
    const user = String(messages[1]?.content)
    expect(user).toContain('<memory>')
    expect(user).toContain('当前交付：')
    expect(user.indexOf('</reference_scope>')).toBeLessThan(user.indexOf('<current_time>'))
    expect(user.indexOf('</current_time>')).toBeLessThan(user.indexOf('<memory>'))
    expect(user.indexOf('</memory>')).toBeLessThan(user.indexOf('<active_state>'))
    expect(user).toContain('计划进度：[todo] 交付结果')
  })
})

describe('ai human history compaction prompt', () => {
  it('splits input into current/earlier and asks for four memory headings', () => {
    const prompt = buildHistoryCompactionPrompt({
      currentText: '[round 1]\n[user] 补风险并改标题',
      earlierText: '[round 1]\n[user] 填周报'
    })
    expect(prompt.user).toContain('<current>')
    expect(prompt.user).toContain('<earlier>')
    expect(prompt.user).toContain('补风险并改标题')
    expect(prompt.user).toContain('填周报')
    expect(prompt.user).not.toContain('<user_goal>')
    expect(prompt.user).not.toContain('<history_text>')
    expect(prompt.system).toContain('当前交付：')
    expect(prompt.system).toContain('已确认事实：')
    expect(prompt.system).toContain('已尝试但未解决：')
    expect(prompt.system).toContain('历史事实：')
    expect(prompt.system).toContain('整份重写')
  })
})
