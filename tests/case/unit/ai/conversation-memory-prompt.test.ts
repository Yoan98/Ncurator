import { describe, expect, it } from 'vitest'
import { buildConversationMemoryPrompt } from '../../../../src/main/services/ai/memory/prompts/conversation'

describe('ai unit conversation memory prompt', () => {
  it('renders semantic system and user sections for conversation memory updates', () => {
    const prompt = buildConversationMemoryPrompt({
      previousSummary: '用户正在整理风险周报。',
      turnsText: [
        'user: 继续检查风险项。',
        'assistant: 已生成风险项草稿。',
        'artifacts:',
        '- file；fileName=risk.docx；summary=风险项草稿'
      ].join('\n')
    })

    expect(prompt.system).toContain('<role>')
    expect(prompt.system).toContain('<principles>')
    expect(prompt.system).toContain('<output_contract>')
    expect(prompt.system).toContain('<output_example>')
    expect(prompt.system).toContain('"summary"')
    expect(prompt.system).toContain('生成更新后的完整摘要')
    expect(prompt.system).toContain('保留未来对话仍可能需要延续的主线')
    expect(prompt.system).not.toContain('<background>')
    expect(prompt.system).not.toContain('human run')
    expect(prompt.system).not.toContain('brain prompt')
    expect(prompt.system).not.toContain('recent_turns')
    expect(prompt.system).not.toContain('rounds')
    expect(prompt.system).not.toContain('compactions')
    expect(prompt.user).toContain('<conversation_summary_task>')
    expect(prompt.user).toContain('<previous_summary>')
    expect(prompt.user).toContain('用户正在整理风险周报。')
    expect(prompt.user).toContain('<new_turns>')
    expect(prompt.user).toContain('继续检查风险项。')
    expect(prompt.user).toContain('已生成风险项草稿。')
    expect(prompt.user).toContain('fileName=risk.docx')
    expect(prompt.user).toContain('summary=风险项草稿')
  })
})
