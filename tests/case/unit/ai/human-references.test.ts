import { describe, expect, it } from 'vitest'
import { brainNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import {
  buildEvidenceReferenceMarkdown,
  inferReferenceIconKind
} from '../../../../src/main/services/ai/human/shared/references'
import { applyBrainDecisionState } from '../../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

describe('ai unit human references', () => {
  it('accepts evidence references only on mouth nextAction', () => {
    expect(
      brainNextActionSchema.parse({
        action: 'mouth',
        evidenceReferences: [
          {
            label: 'report.docx',
            path: '/tmp/workspace/report.docx',
            resourceType: 'file',
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
        evidenceReferences: [
          {
            label: 'report.docx',
            path: '/tmp/workspace/report.docx',
            resourceType: 'file',
            usedFor: 'invalid'
          }
        ]
      })
    ).toThrow()
  })

  it('copies brain mouth evidence references into execution state', () => {
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
          evidenceReferences: [
            {
              label: 'report.docx',
              path: '/tmp/workspace/report.docx',
              resourceType: 'file',
              usedFor: '用于支撑最终答复中的周报结论'
            },
            {
              label: '审批规则网页',
              path: 'https://example.com/approval-rules',
              resourceType: 'web',
              usedFor: '用于补充最终答复中的通用审批背景说明'
            }
          ]
        }
      },
      thoughtMemory: initialState.memory.thought,
      createdAt: 1
    })

    expect(nextState.execution.evidenceReferences).toEqual([
      {
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        resourceType: 'file',
        usedFor: '用于支撑最终答复中的周报结论'
      },
      {
        label: '审批规则网页',
        path: 'https://example.com/approval-rules',
        resourceType: 'web',
        usedFor: '用于补充最终答复中的通用审批背景说明'
      }
    ])
  })

  it('builds markdown ref links and infers icon kinds from path', () => {
    expect(
      buildEvidenceReferenceMarkdown({
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        resourceType: 'file',
        usedFor: '用于周报撰写'
      })
    ).toContain('kind=reference')

    expect(inferReferenceIconKind({ resourceType: 'file' })).toBe('file')
    expect(inferReferenceIconKind({ resourceType: 'web' })).toBe('web')
  })
})
