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
    sessionId: 'session-prompt-formatting',
    runStartedAt: 0,
    preference: 'default',
    workspace: {
      workspaceId: 'workspace-prompt-formatting',
      workspaceName: 'prompt formatting workspace',
      rootPath: 'D:\\workspace'
    },
    referenceScope: {
      workspace: {
        id: 'workspace-prompt-formatting',
        rootPath: 'D:\\workspace'
      },
      selectedReferences: []
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

  it('renders the local environment inside the system prompt', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })
    const environment =
      system.match(/<local_environment>([\s\S]*?)<\/local_environment>/)?.[1] || ''

    expect(environment).toContain('platform：windows')
    expect(environment).toContain('runtime_paths.scripts：')
    expect(environment).toContain('runtime_paths.assets：')
  })

  it('keeps context efficiency and planning rules concise', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })
    const skillLoading = system.match(/<skill_loading>([\s\S]*?)<\/skill_loading>/)?.[1] || ''
    const efficiency =
      system.match(/<context_efficiency>([\s\S]*?)<\/context_efficiency>/)?.[1] || ''

    expect(skillLoading).toContain('尽早一次性学习当前任务已明确需要的技能')
    expect(skillLoading).toContain('不学习只是可能用到的技能')
    expect(efficiency).toContain('选择返回结果最贴近目标的工具')
    expect(efficiency).toContain('已获取且未变化的信息直接复用')
    expect(efficiency).not.toContain('outline')
    expect(system).toContain('复杂任务使用计划，并在关键阶段完成、方案变化或任务受阻时更新')
    expect(system).toContain('尽量同轮调用下一步工具')
    expect(system).not.toContain('不为汇报进度单独更新计划')
  })

  it('renders the default preference and reference scope in the user message', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })

    expect(user).toContain('<task_goal>')
    expect(user).toContain('继续处理任务')
    expect(user.match(/<preference>([\s\S]*?)<\/preference>/)?.[1].trim()).toBe('无')
    expect(user).toContain('<reference_scope>')
  })

  it('renders plan and learned skills inside current_state when injectPlan is set', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    state.memory.plan = [
      { title: '整理资料', status: 'done' },
      { title: '检查是否满足诉求', status: 'todo' }
    ]
    state.skills.learnedSkillIds = ['docx-read']

    const user = buildBrainUserMessage({ state, ctx: createFakeCtx(), injectPlan: true })

    const currentState = user.match(/<current_state>([\s\S]*?)<\/current_state>/)?.[1] || ''
    expect(currentState).toContain('<plan>')
    expect(currentState).toContain('[done] 整理资料')
    expect(currentState).toContain('[todo] 检查是否满足诉求')
    expect(currentState).toContain('<learned_skills>')
    expect(currentState).toContain('- docx-read')
  })

  it('renders learned_skills as none when no skill has been learned', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })

    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })
    expect(user).toContain('<learned_skills>none</learned_skills>')
    expect(user).not.toContain('<plan>')
  })
})
