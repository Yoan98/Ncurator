import { describe, expect, it } from 'vitest'
import { ASK_USER_QUESTION_SCHEMA } from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'
import { buildDispatchQueue } from '../../../../src/main/services/ai/human/node/dispatch'

describe('ask_user_question contract', () => {
  it('accepts minimal questions and rejects more than three', () => {
    const question = { id: 'goal', question: '选择目标', options: [{ id: 'a', label: '方案 A' }] }
    expect(ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question] }).success).toBe(true)
    expect(ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question, question, question, question] }).success).toBe(false)
  })

  it('must be the only tool call in a model response', () => {
    expect(() => buildDispatchQueue([{ id: 'q', name: 'ask_user_question', args: {} }])).not.toThrow()
    expect(() => buildDispatchQueue([
      { id: 'q', name: 'ask_user_question', args: {} },
      { id: 'w', name: 'text_file_edit', args: {} }
    ])).toThrow(/must be the only tool call/)
  })
})
