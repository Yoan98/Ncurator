import { describe, expect, it } from 'vitest'
import { resolveOrtThreadBudget } from '../../../../../src/main/services/vector/indexSpeed'

describe('index speed thread budget', () => {
  it('maps slow and fast ORT budgets for 4, 8 and 16 logical cores', () => {
    expect(resolveOrtThreadBudget('slow', 4)).toEqual({
      intraOpNumThreads: 2,
      allowSpinning: false
    })
    expect(resolveOrtThreadBudget('slow', 8)).toEqual({
      intraOpNumThreads: 4,
      allowSpinning: false
    })
    expect(resolveOrtThreadBudget('slow', 16)).toEqual({
      intraOpNumThreads: 8,
      allowSpinning: false
    })
    expect(resolveOrtThreadBudget('fast', 4)).toEqual({
      intraOpNumThreads: 3,
      allowSpinning: true
    })
    expect(resolveOrtThreadBudget('fast', 8)).toEqual({
      intraOpNumThreads: 7,
      allowSpinning: true
    })
    expect(resolveOrtThreadBudget('fast', 16)).toEqual({
      intraOpNumThreads: 14,
      allowSpinning: true
    })
  })
})
