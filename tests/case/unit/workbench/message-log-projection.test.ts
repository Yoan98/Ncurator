import { describe, expect, it } from 'vitest'
import { projectProcessGroups } from '../../../../src/renderer/src/components/workbench/messageLogProjection'
import type { ChatMessageLogRecord } from '../../../../src/shared/types'

describe('message log question projection', () => {
  it('projects questions from the tool call and all answers from the resolved annotation', () => {
    const runId = 'run-question-projection'
    const records: ChatMessageLogRecord[] = [
      {
        id: 'thinking-started',
        partnerId: 'partner',
        runId,
        seq: 0,
        createdAt: 0,
        entry: {
          kind: 'annotation',
          eventType: 'thinking_started',
          payload: {}
        }
      },
      {
        id: 'assistant-1',
        partnerId: 'partner',
        runId,
        seq: 1,
        createdAt: 1,
        entry: {
          kind: 'assistant',
          content: '需要确认几个会影响结果的问题。',
          toolCalls: [
            {
              id: 'question-call',
              name: 'ask_user_question',
              args: {
                questions: [
                  {
                    id: 'accent',
                    question: '使用什么主色？',
                    options: [
                      { id: 'blue', label: '蓝色' },
                      { id: 'green', label: '绿色' }
                    ]
                  },
                  {
                    id: 'scope',
                    question: '覆盖哪些来源？',
                    options: [
                      { id: 'local', label: '本地资料' },
                      { id: 'web', label: '网页资料' }
                    ],
                    multiSelect: true
                  },
                  {
                    id: 'format',
                    question: '交付什么形式？',
                    options: [{ id: 'brief', label: '简要说明' }]
                  }
                ]
              }
            }
          ]
        }
      },
      {
        id: 'tool-1',
        partnerId: 'partner',
        runId,
        seq: 2,
        createdAt: 2,
        entry: {
          kind: 'tool',
          toolCallId: 'question-call',
          toolName: 'ask_user_question',
          ok: true,
          content: 'The user answered the clarification questions.'
        }
      },
      {
        id: 'resolved-1',
        partnerId: 'partner',
        runId,
        seq: 3,
        createdAt: 3,
        entry: {
          kind: 'annotation',
          eventType: 'human_interaction_resolved',
          payload: {
            interactionId: 'interaction-1',
            kind: 'question',
            result: {
              answers: [
                { id: 'accent', selected: [], custom: '蓝绿色' },
                { id: 'scope', selected: ['local'], custom: '不要引用外部网页' },
                { id: 'format', selected: ['brief'] }
              ]
            }
          }
        }
      }
    ]

    const projection = projectProcessGroups({ runId, records, runFinished: true })
    const item = projection.processGroups
      .flatMap((group) => group.items)
      .find((candidate) => candidate.id === 'question-call')

    expect(item?.interaction?.questions).toHaveLength(3)
    expect(item?.interaction?.questions[1]?.options[0]?.label).toBe('本地资料')
    expect(item?.interaction?.answers).toEqual([
      { id: 'accent', selected: [], custom: '蓝绿色' },
      { id: 'scope', selected: ['local'], custom: '不要引用外部网页' },
      { id: 'format', selected: ['brief'] }
    ])
  })
})
