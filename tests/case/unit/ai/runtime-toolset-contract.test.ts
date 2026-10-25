import { describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import { buildModelToolResultDelivery } from '../../../../src/main/services/ai/human/shared/modelToolResult'
import { SKILL_CONFIG_SCHEMA } from '../../../../src/main/services/ai/human/tools/skillManagement/toolSchemas'
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
    expect(getToolsetDefinition('agent-control').toolNames).not.toContain('skill_config')
    expect(getToolsetDefinition('skill-management')).toMatchObject({
      source: 'external',
      toolNames: ['skill_config'],
      countsTowardToolBudget: true
    })
    for (const input of [
      { action: 'list' },
      { action: 'update', skills: [{ name: 'weekly-report', enabled: true }] },
      {
        action: 'update',
        skills: [
          { name: 'weekly-report', enabled: false },
          { name: 'writing-style', enabled: true }
        ]
      }
    ])
      expect(SKILL_CONFIG_SCHEMA.safeParse(input).success).toBe(true)
    for (const input of [
      {},
      { name: 'weekly-report' },
      { name: 'weekly-report', enabled: true },
      { action: 'list', name: 'weekly-report' },
      { action: 'update', skills: [] },
      { action: 'update', skills: [{ name: '../escape', enabled: true }] },
      { action: 'update', skills: [{ name: 'weekly-report' }] },
      { action: 'update', skills: [{ name: 'weekly-report', enabled: true, partnerId: 'other' }] },
      {
        action: 'update',
        skills: [
          { name: 'weekly-report', enabled: false },
          { name: 'weekly-report', enabled: true }
        ]
      }
    ])
      expect(SKILL_CONFIG_SCHEMA.safeParse(input).success).toBe(false)
    expect(isToolAllowed({ isSubagent: true }, 'skill_config')).toBe(false)
    expect(isToolAllowed({ isSubagent: false }, 'skill_config')).toBe(true)
  })

  it('delivers the affected Chinese partner names and validation reason to the model', async () => {
    const error = 'Skill instructions exceed 64 KiB for: 周报伙伴、复核伙伴'
    const delivered = await buildModelToolResultDelivery({
      ctx: { platform: 'macos' } as AiRunContext,
      toolCallId: 'sync-budget-error',
      args: { action: 'update', skills: [{ name: 'weekly-report', enabled: true }] },
      result: { toolName: 'skill_config', ok: false, data: { error } }
    })
    expect(delivered).toEqual({ ok: false, content: `Error: ${error}` })
  })

  it('renders list entries without a heading and mutation as a plain confirmation', async () => {
    const ctx = { platform: 'macos' } as AiRunContext
    const list = await buildModelToolResultDelivery({
      ctx,
      toolCallId: 'list',
      args: { action: 'list' },
      result: {
        toolName: 'skill_config',
        ok: true,
        data: [
          { name: 'weekly-report', enabled: true },
          { name: 'writing-style', enabled: false }
        ]
      }
    })
    expect(list.content).toBe('- weekly-report：已启用\n- writing-style：未启用')
    const updated = await buildModelToolResultDelivery({
      ctx,
      toolCallId: 'update',
      args: { action: 'update', skills: [{ name: 'weekly-report', enabled: true }] },
      result: { toolName: 'skill_config', ok: true, data: {} }
    })
    expect(updated.content).toBe('修改成功。')
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
