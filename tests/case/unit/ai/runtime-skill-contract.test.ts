import { describe, expect, it } from 'vitest'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
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
      'agent-control'
    ])
    expect(listExternalSkillDefinitions().map((definition) => definition.skillId)).toEqual([
      'docx-read',
      'docx-write',
      'pdf-read',
      'ppt-read',
      'ppt-write',
      'excel-read',
      'excel-write',
      'image-generation',
      'scheduled-tasks'
    ])
  })

  it('binds excel skills to their tool names', () => {
    expect(getSkillDefinition('excel-read').toolNames).toEqual(['excel_read'])
    expect(getSkillDefinition('excel-write').toolNames).toEqual(['excel_edit'])
  })

  it('binds scheduled task skill to one read tool and one action tool', () => {
    expect(getSkillDefinition('scheduled-tasks').toolNames).toEqual([
      'scheduled_task_list',
      'scheduled_task_action'
    ])
  })

  it('includes builtin skills in effective skills before any external learning', () => {
    expect(getEffectiveLearnedSkillIds([])).toEqual([
      'terminal',
      'text-file',
      'kb-retrieval',
      'web-browsing',
      'agent-control'
    ])
  })
})
