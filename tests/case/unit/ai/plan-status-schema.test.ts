import { describe, expect, it } from 'vitest'
import {
  humanPlanItemStatusSchema,
  humanPlanItemSchema
} from '../../../../src/main/services/ai/human/schema'
import { getToolSpec } from '../../../../src/main/services/ai/human/tools/registry'
import { buildToolFeedback } from '../../../../src/main/services/ai/human/shared/toolFeedback'

describe('ai unit plan status schema', () => {
  it('allows todo / in_progress / done as plan item status', () => {
    expect(humanPlanItemStatusSchema.parse('todo')).toBe('todo')
    expect(humanPlanItemStatusSchema.parse('in_progress')).toBe('in_progress')
    expect(humanPlanItemStatusSchema.parse('done')).toBe('done')
    expect(() => humanPlanItemStatusSchema.parse('blocked')).toThrow()
  })

  it('accepts in_progress in the update_plan tool input schema', () => {
    const spec = getToolSpec('update_plan')
    const parsed = spec?.inputSchema.safeParse({
      plan: [
        { title: '撰写周报', status: 'in_progress' },
        { title: '检查是否满足诉求', status: 'todo' }
      ]
    })

    expect(parsed?.success).toBe(true)
  })

  it('rejects unknown plan item status in the update_plan tool input schema', () => {
    const spec = getToolSpec('update_plan')
    const parsed = spec?.inputSchema.safeParse({
      plan: [{ title: '撰写周报', status: 'blocked' }]
    })

    expect(parsed?.success).toBe(false)
  })

  it('keeps the plan item schema and update_plan schema on a single shared definition', () => {
    const spec = getToolSpec('update_plan')
    const planItemParsed = humanPlanItemSchema.safeParse({ title: 'x', status: 'in_progress' })
    const updatePlanParsed = spec?.inputSchema.safeParse({
      plan: [{ title: 'x', status: 'in_progress' }]
    })

    expect(planItemParsed.success).toBe(true)
    expect(updatePlanParsed?.success).toBe(true)
  })
})

describe('ai unit tool feedback envelope', () => {
  it('builds a success envelope with nested result', () => {
    const feedback = buildToolFeedback({
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      result: { message: '计划已更新' }
    })

    expect(JSON.parse(String(feedback.message.content))).toEqual({
      status: 'success',
      result: { message: '计划已更新' }
    })
    expect(feedback.transcript).toEqual({
      kind: 'tool',
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      result: { status: 'success', result: { message: '计划已更新' } }
    })
  })

  it('builds an error envelope with error message', () => {
    const feedback = buildToolFeedback({
      toolCallId: 'call-2',
      toolName: 'update_plan',
      ok: false,
      errorMessage: 'status 仅允许 todo/in_progress/done'
    })

    expect(JSON.parse(String(feedback.message.content))).toEqual({
      status: 'fail',
      error: 'status 仅允许 todo/in_progress/done'
    })
    expect(feedback.transcript.result).toEqual({
      status: 'fail',
      error: 'status 仅允许 todo/in_progress/done'
    })
  })
})
