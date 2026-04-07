import { describe, expect, it } from 'vitest'
import { deriveDeliverySummary } from '../../../src/main/services/ai/human/shared/deliverySummary'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'

describe('ai unit delivery summary', () => {
  it('prefers the first markdown heading as summary', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请整理结果'
    })

    expect(
      deriveDeliverySummary({
        state,
        deliveryMarkdown: '# 最终结论\n\n这里是详情。'
      })
    ).toBe('最终结论')
  })

  it('falls back to the brain decision summary when markdown is empty', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '请整理结果'
    })
    state.lastBrainDecision = {
      memoryOps: [],
      decision: {
        summary: '当前应结束并交付结果',
        reason: '信息已经足够。',
        expectedOutcome: '输出最终答复。'
      },
      readyToDeliver: true,
      nextAction: {
        action: 'mouth'
      }
    }

    expect(
      deriveDeliverySummary({
        state,
        deliveryMarkdown: ''
      })
    ).toBe('当前应结束并交付结果')
  })
})
