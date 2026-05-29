import { describe, expect, it } from 'vitest'
import { buildConversationMemoryPrompt } from '../../../src/main/services/ai/memory/prompts/conversation'

describe('ai unit conversation memory prompt', () => {
  it('renders semantic system and user sections for conversation memory updates', () => {
    const prompt = buildConversationMemoryPrompt({
      previousSummary: '用户正在整理风险周报。',
      latestUserMessage: '继续检查风险项。',
      latestAssistantMessage: '已生成风险项草稿。',
      latestArtifacts: [
        {
          kind: 'file',
          capability: 'docx',
          path: '/workspace/risk.docx',
          fileName: 'risk.docx',
          operation: 'created',
          applyId: 'apply-risk',
          summary: '风险项草稿'
        }
      ]
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
    expect(prompt.user).toContain('<latest_user_message>')
    expect(prompt.user).toContain('继续检查风险项。')
    expect(prompt.user).toContain('<latest_assistant_message>')
    expect(prompt.user).toContain('已生成风险项草稿。')
    expect(prompt.user).toContain('<latest_artifacts>')
    expect(prompt.user).toContain('fileName=risk.docx')
    expect(prompt.user).toContain('summary=风险项草稿')
  })
})
