import { describe, expect, it } from 'vitest'
import { buildSessionMemoryPrompt } from '../../../src/main/services/ai/memory/prompts/session'

describe('ai unit session memory prompt', () => {
  it('renders semantic system and user sections for session memory updates', () => {
    const prompt = buildSessionMemoryPrompt({
      previousRollingSummary: '用户正在整理风险周报。',
      latestUserMessage: '继续检查风险项。',
      latestAssistantMessage: '已生成风险项草稿。',
      latestArtifacts: [
        {
          kind: 'file',
          capability: 'docx',
          path: '/workspace/risk.docx',
          fileName: 'risk.docx',
          operation: 'created',
          artifactRole: 'draft',
          summary: '风险项草稿'
        }
      ]
    })

    expect(prompt.system).toContain('<role>')
    expect(prompt.system).toContain('<goal>')
    expect(prompt.system).toContain('<update_rules>')
    expect(prompt.system).toContain('<keep_rules>')
    expect(prompt.system).toContain('<drop_rules>')
    expect(prompt.system).toContain('<output_contract>')
    expect(prompt.system).toContain('<output_example>')
    expect(prompt.system).toContain('"rollingSummary"')
    expect(prompt.system).toContain('输入旧摘要')
    expect(prompt.system).toContain('输出的是更新后的完整 rollingSummary')
    expect(prompt.system).toContain('在不丢失重要连续性信息的情况下尽可能简短')
    expect(prompt.system).not.toContain('<background>')
    expect(prompt.system).not.toContain('human run')
    expect(prompt.system).not.toContain('brain prompt')
    expect(prompt.system).not.toContain('recent_conversation')
    expect(prompt.system).not.toContain('roundHistory')
    expect(prompt.system).not.toContain('compactBlocks')
    expect(prompt.user).toContain('<session_memory_task>')
    expect(prompt.user).toContain('<previous_rolling_summary>')
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
