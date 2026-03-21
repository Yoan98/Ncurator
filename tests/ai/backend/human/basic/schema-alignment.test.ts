import { describe, expect, it } from 'vitest'
import { aiArtifactRefSchema, aiPlanTaskSchema } from '../../../../../src/main/services/ai/schema'
import {
  brainDecisionRecordSchema,
  lastBrainDecisionSchema,
  mouthOutputSchema
} from '../../../../../src/main/services/ai/human/schema'

describe('human shared schema alignment', () => {
  it('allows mouth output without deliveryMarkdown', () => {
    const parsed = mouthOutputSchema.parse({
      summary: '已完成当前任务。'
    })

    expect(parsed).toEqual({
      summary: '已完成当前任务。'
    })
  })

  it('allows structured artifact refs on shared task/result contracts', () => {
    const artifact = aiArtifactRefSchema.parse({
      kind: 'file',
      capability: 'docx',
      path: '/tmp/demo-preview.docx',
      fileName: 'demo-preview.docx',
      operation: 'created',
      artifactRole: 'preview',
      summary: 'preview generated'
    })
    const planTask = aiPlanTaskSchema.parse({
      id: 'task-1',
      title: '生成预览',
      userInput: '输出预览文件',
      status: 'completed',
      artifacts: [artifact]
    })

    expect(planTask.artifacts).toEqual([artifact])
  })

  it('rejects invalid nextAction shape in lastBrainDecision', () => {
    expect(() =>
      lastBrainDecisionSchema.parse({
        memoryOps: [],
        decision: {
          summary: '继续执行',
          reason: '需要工具结果',
          expectedOutcome: '拿到更多信息'
        },
        nextAction: {
          action: 'hand'
        }
      })
    ).toThrow()
  })

  it('rejects invalid memory ops in brainDecisionRecord', () => {
    expect(() =>
      brainDecisionRecordSchema.parse({
        createdAt: Date.now(),
        decision: {
          summary: '完成整理',
          reason: '已有足够依据',
          expectedOutcome: '输出交付'
        },
        nextAction: {
          action: 'mouth',
          status: 'completed'
        },
        memoryOps: [
          {
            op: 'add',
            field: 'facts',
            value: {
              id: '',
              summary: '缺少 id 的事实',
              evidenceIds: ['e-1']
            }
          }
        ]
      })
    ).toThrow()
  })
})
