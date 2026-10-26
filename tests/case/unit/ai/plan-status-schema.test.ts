import { describe, expect, it } from 'vitest'
import {
  humanPlanItemStatusSchema,
  humanPlanItemSchema
} from '../../../../src/main/services/ai/human/schema'
import { getToolSpec } from '../../../../src/main/services/ai/human/tools/registry'
import { z } from 'zod/v4'
import { formatZodErrorForTool } from '../../../../src/main/services/ai/human/shared/schemaError'

describe('ai unit plan status schema', () => {
  it('allows todo / doing / done as plan item status', () => {
    expect(humanPlanItemStatusSchema.parse('todo')).toBe('todo')
    expect(humanPlanItemStatusSchema.parse('doing')).toBe('doing')
    expect(humanPlanItemStatusSchema.parse('done')).toBe('done')
    expect(() => humanPlanItemStatusSchema.parse('in_progress')).toThrow()
    expect(() => humanPlanItemStatusSchema.parse('blocked')).toThrow()
  })

  it('accepts all three statuses, including multiple doing items', () => {
    const spec = getToolSpec('update_plan')
    const parsed = spec?.inputSchema.safeParse({
      plan: [
        { title: '撰写周报', status: 'done' },
        { title: '校对内容', status: 'doing' },
        { title: '检查引用', status: 'doing' },
        { title: '检查是否满足诉求', status: 'todo' }
      ]
    })

    expect(parsed?.success).toBe(true)
  })

  it('reports the plan field path and the original schema diagnostic', () => {
    const parsed = getToolSpec('update_plan')!.inputSchema.safeParse({
      plan: [{ title: '撰写周报', status: 'blocked' }]
    })
    if (parsed.success) throw new Error('Invalid status was accepted')
    const message = formatZodErrorForTool('update_plan', parsed.error)
    expect(message).toContain('plan[0].status')
    expect(message).toContain(parsed.error.issues[0].message)
    expect(message).toContain('doing')
  })

  it('preserves native missing-field, type, length and custom diagnostics', () => {
    const schema = z.object({
      name: z.string(),
      count: z.number(),
      items: z.array(z.string()).min(1),
      code: z.string().refine(() => false, { message: '原始诊断：路径 /文档/周报' })
    })
    const parsed = schema.safeParse({ count: 'bad', items: [], code: 'test' })
    if (parsed.success) throw new Error('Invalid arguments were accepted')
    for (const issue of parsed.error.issues) {
      const message = formatZodErrorForTool('test', { issues: [issue] })
      expect(message).toContain(issue.path.join('.'))
      expect(message).toContain(issue.message)
    }
    expect(formatZodErrorForTool('test', parsed.error)).toContain('1 more validation errors.')
  })

  it('keeps schema-native diagnostics for unknown fields', () => {
    const parsed = z.object({}).strict().safeParse({ extra: true })
    if (parsed.success) throw new Error('Unknown field was accepted')
    expect(formatZodErrorForTool('test', parsed.error)).toContain(parsed.error.issues[0].message)
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
