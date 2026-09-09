import { describe, expect, it } from 'vitest'
import {
  humanPlanItemStatusSchema,
  humanPlanItemSchema
} from '../../../../src/main/services/ai/human/schema'
import { getToolSpec } from '../../../../src/main/services/ai/human/tools/registry'
import { buildToolFeedback } from '../../../../src/main/services/ai/human/shared/toolFeedback'
import { messagesFromLogEntries } from '../../../../src/main/services/ai/human/memory/conversationLogMessages'

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

describe('ai unit tool feedback text', () => {
  it('preserves explicit success text in the model message and transcript', () => {
    const transcript = buildToolFeedback({
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      content: 'Plan updated successfully.'
    })
    const message = messagesFromLogEntries([transcript])[0]

    expect(String(message?.content)).toBe('Plan updated successfully.')
    expect(transcript).toEqual({
      kind: 'tool',
      toolCallId: 'call-1',
      toolName: 'update_plan',
      ok: true,
      content: String(message?.content)
    })
  })

  it('builds an English error message without exposing non-English internals', () => {
    const transcript = buildToolFeedback({
      toolCallId: 'call-2',
      toolName: 'update_plan',
      ok: false,
      errorMessage: 'status 仅允许 todo/done'
    })
    const message = messagesFromLogEntries([transcript])[0]

    expect(String(message?.content)).toBe(
      'Error: The tool call failed. Check the tool arguments and try again.'
    )
    expect(transcript.content).toBe(String(message?.content))
  })
})
