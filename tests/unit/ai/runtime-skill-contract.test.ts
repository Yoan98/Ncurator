import { describe, expect, it } from 'vitest'
import {
  getEffectiveLearnedSkillIds,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../../../src/main/services/ai/human/skills'

describe('ai unit runtime skill contract', () => {
  it('exposes terminal and kb-retrieval as builtin skills', () => {
    expect(listBuiltinSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'history-recall',
      'terminal',
      'kb-retrieval'
    ])
    expect(listExternalSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'docx-read',
      'docx-write'
    ])
  })

  it('includes builtin skills in effective skills before any external learning', () => {
    expect(getEffectiveLearnedSkillIds([])).toEqual([
      'history-recall',
      'terminal',
      'kb-retrieval'
    ])
  })
})
