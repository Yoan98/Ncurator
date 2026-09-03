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

  it('renders the local environment inside the system prompt without current time', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })
    const environment =
      system.match(/<local_environment>([\s\S]*?)<\/local_environment>/)?.[1] || ''

    expect(environment).toContain('platform：windows')
    expect(environment).toContain('runtime_paths.scripts：')
    expect(environment).toContain('runtime_paths.assets：')
    expect(environment).not.toContain('current_time')
    expect(system).not.toContain('current_time.local_iso')
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

  it('renders the default preference, reference scope and current time in the user message', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })

    expect(user).toContain('<task_goal>')
    expect(user).toContain('继续处理任务')
    expect(user.match(/<preference>([\s\S]*?)<\/preference>/)?.[1].trim()).toBe('无')
    expect(user).toContain('<reference_scope>')
    expect(user).toContain('<current_time>')
    expect(user).toContain('current_time.local_iso')
    expect(user).not.toContain('<active_state>')
  })

  it('omits active_state on the normal first-run user even if skills and plan exist', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    state.memory.plan = [{ title: '整理资料', status: 'done' }]
    state.skills.learnedSkillIds = ['docx-read']
    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })
    expect(user).not.toContain('<active_state>')
    expect(user).not.toContain('已学习技能')
    expect(user).not.toContain('计划进度')
  })

  it('renders plan and learned skills inside active_state only when injected', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })
    state.memory.plan = [
      { title: '整理资料', status: 'done' },
      { title: '检查是否满足诉求', status: 'todo' }
    ]
    state.skills.learnedSkillIds = ['docx-read']

    const user = buildBrainUserMessage({
      state,
      ctx: createFakeCtx(),
      injectActiveState: true
    })

    const currentState = user.match(/<active_state>([\s\S]*?)<\/active_state>/)?.[1] || ''
    expect(currentState).toContain('计划进度：')
    expect(currentState).toContain('[done] 整理资料')
    expect(currentState).toContain('[todo] 检查是否满足诉求')
    expect(currentState).toContain('已学习技能：docx-read')
  })

  it('renders learned_skills as none when injected with no learned skill', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-formatting',
      userInput: '继续处理任务'
    })

    const user = buildBrainUserMessage({
      state,
      ctx: createFakeCtx(),
      injectActiveState: true
    })
    expect(user).toContain('已学习技能：无')
    expect(user).not.toContain('计划进度：')
  })

  it('renders compacted history as a sibling before current time and active state', () => {
    const state = createInitialHumanState({
      taskId: 'task-prompt-compaction',
      userInput: '继续处理任务'
    })
    state.skills.learnedSkillIds = ['docx-read']
    const user = buildBrainUserMessage({
      state,
      ctx: createFakeCtx(),
      compactedHistoryText: '任务锚点：继续处理已确认事实',
      injectActiveState: true
    })
    expect(user).toContain('<compacted_history>\n任务锚点：继续处理已确认事实\n  </compacted_history>')
    expect(user.indexOf('</reference_scope>')).toBeLessThan(user.indexOf('<compacted_history>'))
    expect(user.indexOf('</compacted_history>')).toBeLessThan(user.indexOf('<current_time>'))
    expect(user.indexOf('</current_time>')).toBeLessThan(user.indexOf('<active_state>'))
    expect(user.match(/<active_state>[\s\S]*<compacted_history>/)).toBeNull()
  })
})
