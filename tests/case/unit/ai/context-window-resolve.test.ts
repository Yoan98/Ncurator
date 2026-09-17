import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS,
  resolveCompactionTailTokens,
  resolveEffectiveContextWindowTokens,
  resolveModelContextTokens
} from '../../../../src/main/services/ai/human/constants'

describe('ai unit context window resolve', () => {
  it('defaults unknown or invalid model context to 256k', () => {
    expect(resolveModelContextTokens()).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(0)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(-1)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
    expect(resolveModelContextTokens(Number.NaN)).toBe(DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS)
  })

  it('applies 80% utilization and caps at 256k', () => {
    expect(resolveEffectiveContextWindowTokens()).toBe(204_800)
    expect(resolveEffectiveContextWindowTokens(32_000)).toBe(25_600)
    expect(resolveEffectiveContextWindowTokens(1_000_000)).toBe(256_000)
    expect(resolveEffectiveContextWindowTokens(256_000)).toBe(204_800)
  })

  it('keeps tail at 10% of the effective window', () => {
    expect(resolveCompactionTailTokens(204_800)).toBe(20_480)
    expect(resolveCompactionTailTokens(25_600)).toBe(2_560)
    expect(resolveCompactionTailTokens(256_000)).toBe(25_600)
  })
})
