import { describe, expect, it } from 'vitest'
import {
  buildBrainSystemPrompt,
  buildBrainUserMessage
} from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'windows',
    runId: 'run-prompt-formatting',
    partnerId: 'partner-prompt-formatting',
    partnerName: '测试伙伴',
    workspaceRoots: ['D:\\workspace'],
    runStartedAt: 0,
    preference: 'default',
    executionPermission: 'review',
    referenceScope: {
      selectedReferences: [],
      attachments: []
    }
  }) as AiRunContext

describe('ai unit brain prompt formatting', () => {
  it('renders skill entries without learning hints or blank lines between adjacent entries', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const skillCatalog =
      system.match(/<skill_catalog>([\s\S]*?)<\/skill_catalog>/)?.[1].trim() || ''

    expect(skillCatalog).toContain('始终可用的内置技能：')
    expect(skillCatalog).toContain('需要先学习才能使用的外部技能：')
    expect(skillCatalog).toContain('最多同时激活')
    expect(skillCatalog).toContain('个工具')
    expect(skillCatalog).toContain('- terminal（')
    expect(skillCatalog).toContain('- docx-read（')
    expect(skillCatalog).not.toContain('learning 时填写')
    expect(skillCatalog).not.toMatch(/^- [^\n]+\n\n- /m)
  })

  it('keeps stable local environment in system and puts workspace roots in the user message', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const environment =
      system.match(/<local_environment>([\s\S]*?)<\/local_environment>/)?.[1] || ''
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const user = buildBrainUserMessage({ state, ctx })

    expect(environment).toContain('platform：windows')
    expect(environment).toContain('runtime_paths.scripts：')
    expect(environment).toContain('runtime_paths.assets：')
    expect(environment).not.toContain('用户默认工作地址')
    expect(environment).not.toContain('D:\\workspace')
    expect(environment).not.toContain('current_time')
    expect(system).not.toContain('current_time.local_iso')
    expect(system).not.toContain('<workspace_roots>')
    expect(user).toContain('<workspace_roots>')
    expect(user).toContain('D:\\workspace')
    expect(user).not.toContain('<preference>')
    expect(user).not.toContain('<reference_scope>')
    expect(user.indexOf('</workspace_roots>')).toBeLessThan(user.indexOf('<current_time>'))
    expect(system).not.toContain('reference_field_guide')
    expect(system).not.toContain('字段说明')
  })

  it('keeps context efficiency and planning rules concise', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })
    const planContract =
      system.match(/<plan_contract>([\s\S]*?)<\/plan_contract>/)?.[1].trim() || ''

    expect(planContract).toBe(
      '- 只在复杂任务时使用计划，并只在关键阶段完成、方案需要变化时才更新。'
    )
    expect(system).not.toContain('<skill_loading>')
    expect(system).not.toContain('<context_efficiency>')
  })

  it('omits empty preference, workspace roots and reference scope from the user message', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const emptyCtx = {
      ...createFakeCtx(),
      workspaceRoots: []
    } as AiRunContext
    const emptyUser = buildBrainUserMessage({ state, ctx: emptyCtx })

    expect(emptyUser).toContain('<task_goal>')
    expect(emptyUser).toContain('继续处理任务')
    expect(emptyUser).not.toContain('<preference>')
    expect(emptyUser).not.toContain('<workspace_roots>')
    expect(emptyUser).not.toContain('<reference_scope>')
    expect(emptyUser).toContain('<current_time>')
    expect(emptyUser).toContain('current_time.local_iso')
    expect(emptyUser).not.toContain('<active_state>')
  })

  it('renders non-default preference, workspace roots and reference scope when present', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const ctx = {
      ...createFakeCtx(),
      preference: 'local_sources_relaxed',
      referenceScope: {
        selectedReferences: [
          {
            kind: 'file',
            workspaceId: 'workspace-1',
            nodeId: 'node-1',
            name: 'note.md',
            relativePath: 'note.md',
            absolutePath: 'D:\\workspace\\note.md',
            kbAvailability: 'indexed',
            kbDocumentIds: ['doc-1']
          }
        ],
        attachments: []
      }
    } as AiRunContext
    const user = buildBrainUserMessage({ state, ctx })

    expect(user.match(/<preference>([\s\S]*?)<\/preference>/)?.[1].trim()).toBe(
      '优先使用知识库内容和用户工作区域文件内容作为依据来推进任务'
    )
    expect(user).toContain('<workspace_roots>')
    expect(user).toContain('<reference_scope>')
    expect(user).toContain('1. note.md')
    expect(user).not.toContain('当前没有用户显式指定的参考范围')
    expect(user).not.toContain('当前没有用户添加的附件')
    expect(user.indexOf('</preference>')).toBeLessThan(user.indexOf('<workspace_roots>'))
    expect(user.indexOf('</workspace_roots>')).toBeLessThan(user.indexOf('<reference_scope>'))
    expect(user.indexOf('</reference_scope>')).toBeLessThan(user.indexOf('<current_time>'))
  })

  it('omits memory and active_state even if skills and plan exist', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    state.memory.plan = [{ title: '整理资料', status: 'done' }]
    state.skills.learnedSkillIds = ['docx-read']
    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })
    expect(user).not.toContain('<active_state>')
    expect(user).not.toContain('<memory>')
    expect(user).not.toContain('已学习技能')
    expect(user).not.toContain('计划进度')
  })
})
