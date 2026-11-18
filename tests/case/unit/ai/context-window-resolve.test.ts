import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveCompactionTailTokens,
  resolveEffectiveContextWindowTokens,
  resolveModelContextTokens
} from '../../../../src/main/services/ai/human/constants'

describe('ai unit context window resolve', () => {
  it('defaults unknown or invalid model context to 475k', () => {
    expect(resolveModelContextTokens()).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(0)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(-1)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(Number.NaN)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
  })

  it('applies 80% utilization and caps at 475k', () => {
    expect(resolveEffectiveContextWindowTokens()).toBe(380_000)
    expect(resolveEffectiveContextWindowTokens(32_000)).toBe(25_600)
    expect(resolveEffectiveContextWindowTokens(131_072)).toBe(104_857)
    expect(resolveEffectiveContextWindowTokens(600_000)).toBe(475_000)
    expect(resolveEffectiveContextWindowTokens(1_000_000)).toBe(475_000)
    expect(resolveEffectiveContextWindowTokens(256_000)).toBe(204_800)
  })

  it('keeps tail at 10% of the effective window', () => {
    expect(resolveCompactionTailTokens(204_800)).toBe(20_480)
    expect(resolveCompactionTailTokens(25_600)).toBe(2_560)
    expect(resolveCompactionTailTokens(256_000)).toBe(25_600)
    expect(resolveCompactionTailTokens(380_000)).toBe(38_000)
  })
})
