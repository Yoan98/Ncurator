import { describe, expect, it } from 'vitest'
import {
  getEffectiveLearnedSkillIds,
  getSkillDefinition,
  listBuiltinSkillDefinitions,
  listExternalSkillDefinitions
} from '../../../../src/main/services/ai/human/skills'
import {
  SCHEDULED_TASK_ACTION_SPEC,
  SCHEDULED_TASK_LIST_SPEC
} from '../../../../src/main/services/ai/human/tools/scheduledTasks/toolSpecs'

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

  it('keeps scheduled task operations in one action schema', () => {
    expect(SCHEDULED_TASK_LIST_SPEC.resolveExecutionMeta({})).toMatchObject({
      mutability: 'read_only'
    })
    expect(SCHEDULED_TASK_ACTION_SPEC.resolveExecutionMeta({ action: 'create' })).toMatchObject({
      mutability: 'mutating'
    })

    const create = SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
      action: 'create',
      name: '晨报',
      description: '整理今天的安排',
      scheduleType: 'daily',
      timeOfDay: '09:00'
    })
    expect(create.success).toBe(true)
    const createWithUnknownField = SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
      action: 'create',
      name: '晨报',
      description: '整理今天的安排',
      scheduleType: 'daily',
      timeOfDay: '09:00',
      enabled: false
    })
    expect(createWithUnknownField.success).toBe(false)
    expect(
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({ action: 'delete', id: 'task-1' }).success
    ).toBe(true)
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
