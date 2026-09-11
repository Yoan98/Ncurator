import { describe, expect, it } from 'vitest'
import {
  humanPlanItemStatusSchema,
  humanPlanItemSchema
} from '../../../../src/main/services/ai/human/schema'
import { getToolSpec } from '../../../../src/main/services/ai/human/tools/registry'

describe('ai unit plan status schema', () => {
  it('allows todo / done as plan item status', () => {
    expect(humanPlanItemStatusSchema.parse('todo')).toBe('todo')
    expect(humanPlanItemStatusSchema.parse('done')).toBe('done')
    expect(() => humanPlanItemStatusSchema.parse('in_progress')).toThrow()
    expect(() => humanPlanItemStatusSchema.parse('blocked')).toThrow()
  })

  it('accepts todo and done in the update_plan tool input schema', () => {
    const spec = getToolSpec('update_plan')
    const parsed = spec?.inputSchema.safeParse({
      plan: [
        { title: '撰写周报', status: 'done' },
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
    const planItemParsed = humanPlanItemSchema.safeParse({ title: 'x', status: 'done' })
    const updatePlanParsed = spec?.inputSchema.safeParse({
      plan: [{ title: 'x', status: 'done' }]
    })

    expect(planItemParsed.success).toBe(true)
    expect(updatePlanParsed?.success).toBe(true)
  })
})
