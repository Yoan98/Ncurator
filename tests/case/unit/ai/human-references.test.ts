import { describe, expect, it } from 'vitest'
import { humanNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import { buildEvidenceReferenceMarkdown } from '../../../../src/main/services/ai/human/shared/references'
import { applyBrainDecisionState } from '../../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

describe('ai unit human references', () => {
  it('leaves evidence reference validation to the target node', () => {
    expect(
      humanNextActionSchema.parse({
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
      humanNextActionSchema.parse({
        action: 'learning',
        toolCallId: 'call-learn',
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
    ).not.toThrow()
  })

  it('keeps brain references pending until mouth resolves access status', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-1',
      userInput: '整理结论'
    })

    const nextState = applyBrainDecisionState({
      state: initialState,
      thought: {
        text: '证据足够，准备收尾'
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
      },
      createdAt: 1
    })

    expect(nextState.execution.evidenceReferences).toBeUndefined()
    expect(nextState.execution.pendingRound?.nextAction).toMatchObject({
      action: 'mouth',
      evidenceReferences: [{ label: 'report.docx' }, { label: '审批规则网页' }]
    })
  })

  it('builds evidence markdown with the resolved access status', () => {
    expect(
      buildEvidenceReferenceMarkdown({
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        resourceType: 'file',
        usedFor: '用于周报撰写',
        accessStatus: 'accessible'
      })
    ).toContain('accessStatus=accessible')
  })
})
