import { describe, expect, it } from 'vitest'
import {
  applyQuestionInteractionResult,
  reduceAssistantProcessGroups
} from '../../../../src/renderer/src/components/workbench/utils'
import { projectProcessGroups } from '../../../../src/renderer/src/components/workbench/messageLogProjection'
import type { AiRunEvent, ChatMessageLogRecord } from '../../../../src/shared/types'

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

  it('attaches answers to the live activity when the resolved event arrives', () => {
    const runId = 'run-question-live'
    const requiredEvent: AiRunEvent = {
      type: 'human_interaction_required',
      runId,
      taskId: runId,
      interactionId: 'interaction-1',
      interaction: {
        kind: 'question',
        interactionId: 'interaction-1',
        toolCallId: 'question-call',
        questions: [{
          id: 'style',
          question: '选择风格',
          options: [{ id: 'minimal', label: '极简' }]
        }]
      },
      createdAt: 1
    }
    const groups = reduceAssistantProcessGroups([], requiredEvent)
    const event: AiRunEvent = {
      type: 'human_interaction_resolved',
      runId,
      taskId: runId,
      interactionId: 'interaction-1',
      kind: 'question',
      result: { answers: [{ id: 'style', selected: [], custom: '深绿色和白色' }] },
      resolvedAt: 3
    }
    const updated = applyQuestionInteractionResult(groups, event)
    const item = updated.flatMap((group) => group.items)[0]
    expect(item?.interaction?.answers).toEqual([
      { id: 'style', selected: [], custom: '深绿色和白色' }
    ])
  })

  it('keeps answers when the tool activity is re-emitted after resolution', () => {
    const runId = 'run-question-reemit'
    const requiredEvent: AiRunEvent = {
      type: 'human_interaction_required',
      runId,
      taskId: runId,
      interactionId: 'interaction-1',
      interaction: {
        kind: 'question',
        interactionId: 'interaction-1',
        toolCallId: 'question-call',
        questions: [{
          id: 'style',
          question: '选择风格',
          options: [{ id: 'minimal', label: '极简' }]
        }]
      },
      createdAt: 1
    }
    let groups = reduceAssistantProcessGroups([], requiredEvent)
    groups = applyQuestionInteractionResult(groups, {
      type: 'human_interaction_resolved',
      runId,
      taskId: runId,
      interactionId: 'interaction-1',
      kind: 'question',
      result: { answers: [{ id: 'style', selected: [], custom: '深绿色和白色' }] },
      resolvedAt: 2
    })

    const display = {
      kind: 'tool' as const,
      toolName: 'ask_user_question',
      input: { questions: requiredEvent.interaction.questions }
    }
    groups = reduceAssistantProcessGroups(groups, {
      type: 'assistant_process_item_started',
      runId,
      groupId: `${runId}:tool:question-call`,
      itemId: 'question-call',
      display,
      createdAt: 3
    })
    groups = reduceAssistantProcessGroups(groups, {
      type: 'assistant_process_item_completed',
      runId,
      groupId: `${runId}:tool:question-call`,
      itemId: 'question-call',
      completedAt: 4
    })

    const item = groups.flatMap((group) => group.items)[0]
    expect(item?.interaction?.answers).toEqual([
      { id: 'style', selected: [], custom: '深绿色和白色' }
    ])
  })
})
