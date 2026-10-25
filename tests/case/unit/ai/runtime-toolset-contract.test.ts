import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { buildModelToolResultDelivery } from '../../../../src/main/services/ai/human/shared/modelToolResult'
import { SKILL_SYNC_SCHEMA } from '../../../../src/main/services/ai/human/tools/skills/toolSchemas'
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
    expect(getToolsetDefinition('skill-management').toolNames).toEqual(['skill_sync'])
    for (const input of [
      { action: 'status' },
      { action: 'status', name: 'weekly-report' },
      { action: 'sync', name: 'weekly-report' },
      { action: 'sync', name: 'weekly-report', enabled: false }
    ])
      expect(SKILL_SYNC_SCHEMA.safeParse(input).success).toBe(true)
    for (const input of [
      {},
      { action: 'sync' },
      { action: 'status', enabled: false },
      { action: 'sync', name: '../escape' },
      { action: 'sync', name: 'x', previousName: 'y' },
      { action: 'sync', name: 'x', partnerId: 'other' },
      { action: 'sync', name: 'x', sourcePath: '/draft' }
    ])
      expect(SKILL_SYNC_SCHEMA.safeParse(input).success).toBe(false)
    expect(isToolAllowed({ isSubagent: true }, 'skill_sync')).toBe(false)
    expect(isToolAllowed({ isSubagent: false }, 'skill_sync')).toBe(true)
  })

  it('delivers the affected Chinese partner names and validation reason to the model', async () => {
    const error = 'Skill instructions exceed 64 KiB for: 周报伙伴、复核伙伴'
    const delivered = await buildModelToolResultDelivery({
      ctx: { platform: 'macos' } as AiRunContext,
      toolCallId: 'sync-budget-error',
      args: { action: 'sync', name: 'weekly-report', enabled: true },
      result: { toolName: 'skill_sync', ok: false, data: { error } }
    })
    expect(delivered).toEqual({ ok: false, content: `Error: ${error}` })
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
