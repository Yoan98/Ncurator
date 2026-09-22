import { describe, expect, it } from 'vitest'
import { ASK_USER_QUESTION_SCHEMA } from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'
import { buildDispatchQueue } from '../../../../src/main/services/ai/human/node/dispatch'
import { renderAskUserQuestionModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

describe('ask_user_question contract', () => {
  it('accepts minimal questions and rejects more than three', () => {
    const question = { id: 'goal', question: '选择目标', options: [{ id: 'a', label: '方案 A' }] }
    expect(ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question] }).success).toBe(true)
    expect(
      ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question, question, question, question] })
        .success
    ).toBe(false)
  })

  it('keeps option metadata, supports multi-select, and leaves custom input implicit', () => {
    const parsed = ASK_USER_QUESTION_SCHEMA.safeParse({
      questions: [
        {
          id: 'scope',
          question: '选择范围',
          options: [
            { id: 'a', label: '范围 A', description: '只处理 A', recommended: true },
            { id: 'b', label: '范围 B' }
          ],
          multiSelect: true
        }
      ]
    })
    expect(parsed.success).toBe(true)
    expect(JSON.stringify(parsed)).not.toContain('allowCustom')
    expect(JSON.stringify(parsed)).not.toContain('detail')
    expect(JSON.stringify(parsed)).not.toContain('header')
  })

  it('must be the only tool call in a model response', () => {
    expect(() =>
      buildDispatchQueue([{ id: 'q', name: 'ask_user_question', args: {} }])
    ).not.toThrow()
    expect(() =>
      buildDispatchQueue([
        { id: 'q', name: 'ask_user_question', args: {} },
        { id: 'w', name: 'text_file_edit', args: {} }
      ])
    ).toThrow(/must be the only tool call/)
  })

  it('returns ids and user text without repeating question or option copy', () => {
    const rendered = renderAskUserQuestionModelResult({
      toolName: 'ask_user_question',
      args: {
        questions: [
          {
            id: 'delivery',
            question: '希望如何交付？',
            options: [{ id: 'full', label: '完整方案' }]
          }
        ]
      },
      data: {
        answers: [
          {
            questionId: 'delivery',
            selectedOptionIds: ['full'],
            userText: '用 A，然后再补一份摘要'
          }
        ]
      }
    })

    expect(rendered).toContain('A=first, B=second')
    expect(rendered).toContain('questionId=delivery')
    expect(rendered).toContain('selectedOptionIds=["full"]')
    expect(rendered).toContain('userText="用 A，然后再补一份摘要"')
    expect(rendered).not.toContain('希望如何交付')
    expect(rendered).not.toContain('完整方案')
  })
})
