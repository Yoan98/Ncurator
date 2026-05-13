import { describe, expect, it } from 'vitest'
import { brainNextActionSchema } from '../../../src/main/services/ai/human/schema'
import {
  buildReferenceMarkdown,
  inferReferenceIconKind
} from '../../../src/main/services/ai/human/shared/references'
import { applyBrainDecisionState } from '../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'

describe('ai unit human references', () => {
  it('accepts references only on mouth nextAction', () => {
    expect(
      brainNextActionSchema.parse({
        action: 'mouth',
        references: [
          {
            label: 'report.docx',
            path: '/tmp/workspace/report.docx',
            kind: 'internal',
            usedFor: '用于支撑最终答复中的周报结论'
          }
        ]
      })
    ).toMatchObject({
      action: 'mouth'
    })

    expect(() =>
      brainNextActionSchema.parse({
        action: 'learning',
        wantLearnSkillIds: ['docx-read'],
        references: [
          {
            label: 'report.docx',
            path: '/tmp/workspace/report.docx',
            kind: 'internal',
            usedFor: 'invalid'
          }
        ]
      })
    ).toThrow()
  })

  it('copies brain mouth references into execution state', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '整理结论'
    })

    const nextState = applyBrainDecisionState({
      state: initialState,
      thought: {
        thought: {
          next: '证据足够，准备收尾'
        },
        nextAction: {
          action: 'mouth',
          references: [
            {
              label: 'report.docx',
              path: '/tmp/workspace/report.docx',
              kind: 'internal',
              usedFor: '用于支撑最终答复中的周报结论'
            },
            {
              label: '审批规则常识',
              path: 'knowledge://approval-rules',
              kind: 'external',
              usedFor: '用于补充最终答复中的通用审批背景说明'
            }
          ]
        }
      },
      thoughtMemory: initialState.memory.thought,
      createdAt: 1
    })

    expect(nextState.execution.references).toEqual([
      {
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        kind: 'internal',
        usedFor: '用于支撑最终答复中的周报结论'
      },
      {
        label: '审批规则常识',
        path: 'knowledge://approval-rules',
        kind: 'external',
        usedFor: '用于补充最终答复中的通用审批背景说明'
      }
    ])
  })

  it('builds markdown ref links and infers icon kinds from path', () => {
    expect(
      buildReferenceMarkdown({
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        kind: 'internal',
        usedFor: '用于周报撰写'
      })
    ).toContain('ncurator://ref?')

    expect(inferReferenceIconKind({ label: 'report.docx', path: '/tmp/workspace/report.docx' })).toBe('docx')
    expect(inferReferenceIconKind({ label: 'Project Page', path: 'https://example.com' })).toBe('web')
    expect(inferReferenceIconKind({ label: 'Validation Set', path: 'knowledge://validation-set' })).toBe('knowledge')
  })
})
