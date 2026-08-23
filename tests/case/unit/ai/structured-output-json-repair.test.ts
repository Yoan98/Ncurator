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

  it('returns not ok for non-repairable garbage', () => {
    expect(tryRepairJsonObject('not json at all')).toEqual({ ok: false })
    expect(tryRepairJsonObject('')).toEqual({ ok: false })
    expect(tryRepairJsonObject(undefined)).toEqual({ ok: false })
  })

  it('returns not ok for a JSON array instead of an object', () => {
    expect(tryRepairJsonObject('[1,2,3]')).toEqual({ ok: false })
  })

  it('parsePromptJsonOutput still repairs unescaped quotes for the prompt_json path', () => {
    const raw = '{"answer":"say "hello""}'
    expect(parsePromptJsonOutput(raw)).toEqual({ answer: 'say "hello"' })
  })
})
