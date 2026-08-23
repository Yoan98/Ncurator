import { describe, expect, it } from 'vitest'
import { humanNextActionSchema } from '../../../../src/main/services/ai/human/schema'
import {
  countActiveToolNamesForSkillIds,
  fitSkillIdsToToolBudget
} from '../../../../src/main/services/ai/human/node/learningNode/toolBudget'

type FakeSkillId = 'alpha' | 'beta' | 'gamma' | 'delta' | 'epsilon' | 'zeta'

const FAKE_SKILL_TOOLS: Record<FakeSkillId, readonly string[]> = {
  alpha: ['tool-1', 'tool-2', 'tool-3', 'tool-4', 'tool-5', 'tool-6', 'tool-7', 'tool-8'],
  beta: ['tool-9', 'tool-10', 'tool-11', 'tool-12', 'tool-13', 'tool-14', 'tool-15', 'tool-16'],
  gamma: ['tool-17', 'tool-18', 'tool-19', 'tool-20', 'tool-21'],
  delta: ['tool-22', 'tool-23', 'tool-24', 'tool-25'],
  epsilon: [
    'tool-26',
    'tool-27',
    'tool-28',
    'tool-29',
    'tool-30',
    'tool-31',
    'tool-32',
    'tool-33',
    'tool-34',
    'tool-35',
    'tool-36',
    'tool-37'
  ],
  zeta: [
    'tool-38',
    'tool-39',
    'tool-40',
    'tool-41',
    'tool-42',
    'tool-43',
    'tool-44',
    'tool-45',
    'tool-46',
    'tool-47',
    'tool-48',
    'tool-49'
  ]
}

const getFakeToolNames = (skillId: FakeSkillId): readonly string[] => FAKE_SKILL_TOOLS[skillId]

describe('ai unit learning tool budget', () => {
  it('counts unique active tool names across learned skills', () => {
    const count = countActiveToolNamesForSkillIds({
      skillIds: ['alpha', 'alpha', 'beta'],
      getToolNames: getFakeToolNames
    })

    expect(count).toBe(16)
  })

  it('includes builtin tools and evicts whole skills in FIFO order', () => {
    const builtinToolNames = Array.from({ length: 12 }, (_, index) => `builtin-${index + 1}`)
    const result = fitSkillIdsToToolBudget({
      existingSkillIds: ['alpha', 'beta'],
      requestedSkillIds: ['delta'],
      maxActiveTools: 25,
      baseToolNames: builtinToolNames,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: true,
      learnedSkillIds: ['beta', 'delta'],
      evictedSkillIds: ['alpha'],
      activeToolCount: 24
    })
  })

  it('evicts oldest previously learned skills to preserve newly requested skills under tool budget', () => {
    const result = fitSkillIdsToToolBudget({
      existingSkillIds: ['alpha', 'beta', 'gamma'],
      requestedSkillIds: ['delta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: true,
      learnedSkillIds: ['beta', 'gamma', 'delta'],
      evictedSkillIds: ['alpha'],
      activeToolCount: 17
    })
  })

  it('fails when the newly requested skills alone exceed the active tool budget', () => {
    const result = fitSkillIdsToToolBudget({
      existingSkillIds: ['alpha'],
      requestedSkillIds: ['epsilon', 'zeta'],
      maxActiveTools: 20,
      getToolNames: getFakeToolNames
    })

    expect(result).toEqual({
      ok: false,
      activeToolCount: 24,
      requestedSkillIds: ['epsilon', 'zeta']
    })
  })

  it('allows learning decisions to request three or more skills', () => {
    expect(
      humanNextActionSchema.parse({
        action: 'learning',
        toolCallId: 'call-learning-budget',
        wantLearnSkillIds: ['terminal', 'docx-read', 'docx-write']
      })
    ).toMatchObject({
      action: 'learning',
      wantLearnSkillIds: ['terminal', 'docx-read', 'docx-write']
    })
  })
})
