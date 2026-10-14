import { describe, expect, it } from 'vitest'
import { ASK_USER_QUESTION_SCHEMA } from '../../../../src/main/services/ai/human/tools/agentControl/toolSchemas'
import {
  buildDispatchQueue,
  peekDispatchGroup
} from '../../../../src/main/services/ai/human/node/dispatch'
import { renderAskUserQuestionModelResult } from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

describe('ask_user_question contract', () => {
  it('accepts one to three questions with zero to four options each', () => {
    const question = {
      id: 'goal',
      question: '选择目标',
      options: [
        { id: 'a', label: '方案 A' },
        { id: 'b', label: '方案 B' }
      ]
    }
    expect(ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question] }).success).toBe(true)
    expect(
      ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [question, question, question, question] })
        .success
    ).toBe(false)
    for (const count of [0, 1, 2, 3, 4]) {
      const options = Array.from({ length: count }, (_, index) => ({
        id: `option-${index}`,
        label: `方案 ${index + 1}`
      }))
      expect(
        ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [{ ...question, options }] }).success
      ).toBe(true)
    }
    expect(
      ASK_USER_QUESTION_SCHEMA.safeParse({
        questions: [
          {
            ...question,
            options: [
              ...question.options,
              { id: 'c', label: '方案 C' },
              { id: 'd', label: '方案 D' },
              { id: 'e', label: '方案 E' }
            ]
          }
        ]
      }).success
    ).toBe(false)
  })

  it('accepts omitted or empty options and returns a pure text collaboration reply', () => {
    for (const options of [undefined, []]) {
      const parsed = ASK_USER_QUESTION_SCHEMA.safeParse({
        questions: [
          { id: 'verify', question: '请完成网页验证后回复', ...(options ? { options } : {}) }
        ]
      })
      expect(parsed.success).toBe(true)
    }
    expect(ASK_USER_QUESTION_SCHEMA.safeParse({ questions: [] }).success).toBe(false)
    const rendered = renderAskUserQuestionModelResult({
      toolName: 'ask_user_question',
      args: {},
      data: { answers: [{ questionId: 'verify', selectedOptionIds: [], userText: '验证已完成' }] }
    })
    expect(rendered).toContain('selectedOptionIds=[]')
    expect(rendered).toContain('验证已完成')
    expect(rendered).not.toContain('A=first')
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

  it('keeps multiple questions and mixed tools in order while dispatching one question at a time', () => {
    const queue = buildDispatchQueue([
      { id: 'q1', name: 'ask_user_question', args: { questions: [] } },
      { id: 'q2', name: 'ask_user_question', args: { questions: [] } },
      { id: 'w', name: 'text_file_edit', args: {} }
    ])

    const first = peekDispatchGroup(queue)
    expect(first).toMatchObject({
      empty: false,
      target: 'interaction',
      nextAction: { action: 'interaction', toolCallId: 'q1' },
      rest: [
        { toolCallId: 'q2', target: 'interaction' },
        { toolCallId: 'w', target: 'hand' }
      ]
    })
    if (first.empty) throw new Error('expected the first interaction')

    const second = peekDispatchGroup(first.rest)
    expect(second).toMatchObject({
      empty: false,
      target: 'interaction',
      nextAction: { action: 'interaction', toolCallId: 'q2' },
      rest: [{ toolCallId: 'w', target: 'hand' }]
    })

    const handFirst = peekDispatchGroup(
      buildDispatchQueue([
        { id: 'w', name: 'text_file_edit', args: {} },
        { id: 'q', name: 'ask_user_question', args: { questions: [] } }
      ])
    )
    expect(handFirst).toMatchObject({
      empty: false,
      target: 'hand',
      nextAction: { action: 'hand', calls: [{ toolCallId: 'w' }] },
      rest: [{ toolCallId: 'q', target: 'interaction' }]
    })
  })

  it('returns ids and user text without repeating question or option copy', () => {
    const rendered = renderAskUserQuestionModelResult({
      toolName: 'ask_user_question',
      args: {
        questions: [
          {
            id: 'delivery',
            question: '希望如何交付？',
            options: [
              { id: 'full', label: '完整方案' },
              { id: 'brief', label: '简版方案' }
            ]
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

    expect(rendered).not.toContain('A=first')
    expect(rendered).toContain('questionId=delivery')
    expect(rendered).toContain('selectedOptionIds=["full"]')
    expect(rendered).toContain('userText="用 A，然后再补一份摘要"')
    expect(rendered).not.toContain('希望如何交付')
    expect(rendered).not.toContain('完整方案')
  })
})
