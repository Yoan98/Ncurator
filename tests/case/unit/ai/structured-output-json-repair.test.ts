import { describe, expect, it } from 'vitest'
import {
  parsePromptJsonOutput,
  tryRepairJsonObject
} from '../../../../src/main/services/ai/structuredOutput'

describe('ai unit structured output json repair', () => {
  it('accepts already valid JSON without repair', () => {
    const result = tryRepairJsonObject('{"plan":[{"title":"a","status":"todo"}]}')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ plan: [{ title: 'a', status: 'todo' }] })
    }
  })

  it('repairs unescaped double quotes inside string values', () => {
    const raw = '{"plan":[{"title":"找到"反走样"一节","status":"todo"}]}'
    const result = tryRepairJsonObject(raw)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({
        plan: [{ title: '找到"反走样"一节', status: 'todo' }]
      })
    }
  })

  it('returns not ok with a self-owned clean error for non-repairable garbage', () => {
    expect(tryRepairJsonObject('')).toEqual({ ok: false, error: 'arguments 为空，无法解析。' })
    expect(tryRepairJsonObject(undefined)).toEqual({
      ok: false,
      error: 'arguments 为空，无法解析。'
    })

    const garbage = tryRepairJsonObject('not json at all')
    expect(garbage.ok).toBe(false)
    if (!garbage.ok) {
      expect(typeof garbage.error).toBe('string')
      expect(garbage.error.length).toBeGreaterThan(0)
      expect(garbage.error).not.toContain('Troubleshooting URL')
      expect(garbage.error).not.toContain('OUTPUT_PARSING_FAILURE')
    }
  })

  it('returns not ok for a JSON array instead of an object', () => {
    const result = tryRepairJsonObject('[1,2,3]')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBe('arguments 解析成功但不是 JSON 对象。')
    }
  })

  it('parsePromptJsonOutput still repairs unescaped quotes for the prompt_json path', () => {
    const raw = '{"answer":"say "hello""}'
    expect(parsePromptJsonOutput(raw)).toEqual({ answer: 'say "hello"' })
  })
})
