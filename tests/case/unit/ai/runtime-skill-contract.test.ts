import { describe, expect, it } from 'vitest'
import {
  getEffectiveLearnedSkillIds,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../../../../src/main/services/ai/human/skills'

describe('ai unit runtime skill contract', () => {
  it('exposes builtin skills', () => {
    expect(listBuiltinSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'terminal',
      'text-file',
      'kb-retrieval',
      'web-browsing',
      'utility',
      'image-recognition',
      'image-generation',
      'agent-control'
    ])
    expect(listExternalSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'docx-read',
      'docx-write',
      'pdf-read',
      'ppt-read',
      'ppt-write',
      'excel-read',
      'excel-write'
    ])
  })

  it('includes builtin skills in effective skills before any external learning', () => {
    expect(getEffectiveLearnedSkillIds([])).toEqual([
      'terminal',
      'text-file',
      'kb-retrieval',
      'web-browsing',
      'utility',
      'image-recognition',
      'image-generation',
      'agent-control'
    ])
  })
})
