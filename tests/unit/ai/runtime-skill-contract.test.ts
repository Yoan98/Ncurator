import { describe, expect, it } from 'vitest'
import {
  getEffectiveLearnedSkillIds,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../../../src/main/services/ai/human/skills'

describe('ai unit runtime skill contract', () => {
  it('exposes builtin skills', () => {
    expect(listBuiltinSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'terminal',
      'kb-retrieval',
      'web-browsing',
      'utility'
    ])
    expect(listExternalSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'docx-read',
      'docx-write'
    ])
  })

  it('includes builtin skills in effective skills before any external learning', () => {
    expect(getEffectiveLearnedSkillIds([])).toEqual([
      'terminal',
      'kb-retrieval',
      'web-browsing',
      'utility'
    ])
  })
})
