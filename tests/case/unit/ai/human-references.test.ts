import { describe, expect, it } from 'vitest'
import { brainNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import {
  buildReferenceMarkdown,
  inferReferenceIconKind
} from '../../../../src/main/services/ai/human/shared/references'
import { applyBrainDecisionState } from '../../../../src/main/services/ai/human/node/utils/stateTransitionState'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'

describe('ai unit human references', () => {
  it('accepts references only on mouth nextAction', () => {
    expect(
      brainNextActionSchema.parse({
        action: 'mouth',
        references: [
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
        references: [
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

    expect(nextState.execution.references).toEqual([
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
      buildReferenceMarkdown({
        label: 'report.docx',
        path: '/tmp/workspace/report.docx',
        resourceType: 'file',
        usedFor: '用于周报撰写'
      })
    ).toContain('kind=reference')

    expect(inferReferenceIconKind({ resourceType: 'file' })).toBe('file')
    expect(inferReferenceIconKind({ resourceType: 'web' })).toBe('web')
  })

  it('keeps readable unicode in markdown ref links without full URL encoding', () => {
    const markdown = buildReferenceMarkdown({
      label: '工作/客户周会纪要.docx',
      path: '/Users/test/work-space/test/workspace/工作/客户周会纪要.docx',
      resourceType: 'file',
      usedFor: '了解客户关注点'
    })

    expect(markdown).toContain('label=工作/客户周会纪要.docx')
    expect(markdown).toContain('path=/Users/test/work-space/test/workspace/工作/客户周会纪要.docx')
    expect(markdown).not.toContain('%E5')
  })

  it('escapes only query-breaking characters in markdown ref links', () => {
    const markdown = buildReferenceMarkdown({
      label: 'A&B=测试.docx',
      path: 'https://example.com/a?x=1&name=测试',
      resourceType: 'web',
      usedFor: '验证链接参数'
    })

    expect(markdown).toContain('label=A%26B%3D测试.docx')
    expect(markdown).toContain('path=https://example.com/a?x%3D1%26name%3D测试')
    expect(markdown).not.toContain('%E6')
  })
})
