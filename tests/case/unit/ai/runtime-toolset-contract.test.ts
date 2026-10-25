import { describe, expect, it } from 'vitest'
import {
  SKILL_READ_SCHEMA,
  SKILL_EDIT_SCHEMA
} from '../../../../src/main/services/ai/human/tools/skills/toolSchemas'
import { isToolAllowed } from '../../../../src/main/services/ai/run/toolPolicy'
import {
  getEffectiveLoadedToolsetIds,
  getToolsetDefinition,
  listBuiltinToolsetDefinitions,
  listExternalToolsetDefinitions
} from '../../../../src/main/services/ai/human/toolsets'
import {
  SCHEDULED_TASK_ACTION_SPEC,
  SCHEDULED_TASK_LIST_SPEC
} from '../../../../src/main/services/ai/human/tools/scheduledTasks/toolSpecs'

describe('ai unit runtime toolset contract', () => {
  it('keeps skill management minimal and restricted to the main partner', () => {
    expect(getToolsetDefinition('skill-management').toolNames).toEqual(['skill_read', 'skill_edit'])
    for (const input of [{}, { id: 'id' }])
      expect(SKILL_READ_SCHEMA.safeParse(input).success).toBe(true)
    for (const input of [{ cursor: 'x' }, { id: '' }, { partnerId: 'other' }, { name: 'weekly' }])
      expect(SKILL_READ_SCHEMA.safeParse(input).success).toBe(false)
    for (const input of [
      { sourcePath: '/draft' },
      { id: 'id', enabled: false },
      { id: 'id', sourcePath: '/draft', enabled: true }
    ])
      expect(SKILL_EDIT_SCHEMA.safeParse(input).success).toBe(true)
    for (const input of [
      {},
      { id: 'id' },
      { enabled: true },
      { sourcePath: '/draft', partnerId: 'other' },
      { sourcePath: '/draft', revision: 'x' }
    ])
      expect(SKILL_EDIT_SCHEMA.safeParse(input).success).toBe(false)
    for (const name of ['skill_read', 'skill_edit']) {
      expect(isToolAllowed({ isSubagent: true }, name)).toBe(false)
      expect(isToolAllowed({ isSubagent: false }, name)).toBe(true)
    }
  })
  it('exposes builtin toolsets', () => {
    expect(listBuiltinToolsetDefinitions().map((definition) => definition.toolsetId)).toEqual([
      'terminal',
      'text-file',
      'kb-retrieval',
      'web-browsing',
      'agent-control'
    ])
    expect(listExternalToolsetDefinitions().map((definition) => definition.toolsetId)).toEqual([
      'docx-read',
      'docx-write',
      'pdf-read',
      'ppt-read',
      'ppt-write',
      'excel-read',
      'excel-write',
      'image-generation',
      'scheduled-tasks',
      'skill-management'
    ])
  })

  it('binds excel toolsets to their tool names', () => {
    expect(getToolsetDefinition('excel-read').toolNames).toEqual(['excel_read'])
    expect(getToolsetDefinition('excel-write').toolNames).toEqual(['excel_edit'])
  })

  it('binds scheduled task toolset to one read tool and one action tool', () => {
    expect(getToolsetDefinition('scheduled-tasks').toolNames).toEqual([
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
    expect(
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
        action: 'create',
        name: '晨报',
        description: '整理今天的安排',
        scheduleType: 'daily',
        timeOfDay: '9:00'
      }).success
    ).toBe(false)
    expect(
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
        action: 'create',
        name: '晨报',
        description: '整理今天的安排',
        scheduleType: 'weekly',
        timeOfDay: '09:00'
      }).success
    ).toBe(false)
    expect(
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
        action: 'create',
        name: '晨报',
        description: '整理今天的安排',
        scheduleType: 'weekly',
        timeOfDay: '09:00',
        weekday: 1
      }).success
    ).toBe(true)
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
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({
        action: 'update',
        id: 'task-1'
      }).success
    ).toBe(false)
    expect(SCHEDULED_TASK_LIST_SPEC.inputSchema.safeParse({ unexpected: true }).success).toBe(false)
    expect(
      SCHEDULED_TASK_ACTION_SPEC.inputSchema.safeParse({ action: 'delete', id: 'task-1' }).success
    ).toBe(true)
  })

  it('includes builtin toolsets in effective toolsets before any external loading', () => {
    expect(getEffectiveLoadedToolsetIds([])).toEqual([
      'terminal',
      'text-file',
      'kb-retrieval',
      'web-browsing',
      'agent-control'
    ])
  })
})
