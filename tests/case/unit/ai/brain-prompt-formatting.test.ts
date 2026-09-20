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

const titledSection = (text: string, title: string): string => {
  const marker = `${title}：\n`
  const start = text.indexOf(marker)
  if (start < 0) return ''
  const after = text.slice(start + marker.length)
  const next = after.search(/\n\n[^\n]+：\n/)
  return (next < 0 ? after : after.slice(0, next)).trim()
}

describe('ai unit brain prompt formatting', () => {
  it('renders skill entries without learning hints or blank lines between adjacent entries', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })

    expect(system).toContain('你叫测试伙伴')
    expect(system).toContain('始终可用的内置技能：')
    expect(system).toContain('需要先学习才能使用的外部技能：')
    expect(system).toContain('最多同时激活')
    expect(system).toContain('个工具')
    expect(system).toContain('- terminal（')
    expect(system).toContain('- docx-read（')
    expect(system).not.toContain('learning 时填写')
    expect(system).not.toMatch(/^- [^\n]+\n\n- /m)
  })

  it('keeps stable local environment in system and puts workspace roots in the user message', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const environment = titledSection(system, '当前运行环境')
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
    expect(system).not.toContain('工作区：')
    expect(user).toContain('默认工作区：')
    expect(titledSection(user, '默认工作区')).toBe('- D:\\workspace')
    expect(user).not.toContain('用户默认工作区域')
    expect(user).toContain('D:\\workspace')
    expect(user).not.toContain('偏好：')
    expect(user).not.toContain('用户@的参考资料：')
    expect(user).not.toContain('用户添加的附件：')
    expect(user.indexOf('默认工作区：')).toBeLessThan(user.indexOf('当前时间：'))
    expect(system).not.toContain('reference_field_guide')
    expect(system).not.toContain('字段说明')
    expect(system).not.toContain('终端等待规则：')
    expect(system.indexOf('原则：')).toBeLessThan(system.indexOf('计算规则：'))
    expect(system.indexOf('计算规则：')).toBeLessThan(system.indexOf('计划规则：'))
    expect(system.indexOf('计划规则：')).toBeLessThan(system.indexOf('交付规则：'))
    expect(system.indexOf('交付规则：')).toBeLessThan(system.indexOf('特别说明规则：'))
    expect(system.indexOf('特别说明规则：')).toBeLessThan(system.indexOf('技能目录：'))
    expect(system.indexOf('技能目录：')).toBeLessThan(system.indexOf('当前运行环境：'))
    expect(titledSection(system, '特别说明规则')).toContain('合理使用终端等待命令')
  })

  it('keeps context efficiency and planning rules concise', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })
    const planContract = titledSection(system, '计划规则')

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

    expect(emptyUser).toContain('用户诉求：')
    expect(emptyUser).toContain('继续处理任务')
    expect(emptyUser).not.toContain('偏好：')
    expect(emptyUser).not.toContain('默认工作区：')
    expect(emptyUser).not.toContain('用户@的参考资料：')
    expect(emptyUser).not.toContain('用户添加的附件：')
    expect(emptyUser).toContain('当前时间：')
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

    expect(titledSection(user, '偏好')).toBe(
      '优先使用知识库内容和用户工作区域文件内容作为依据来推进任务'
    )
    expect(user).toContain('默认工作区：')
    expect(user).toContain('用户@的参考资料：')
    expect(user).toContain('1. note.md')
    expect(user).not.toContain('用户添加的附件：')
    expect(user).not.toContain('当前没有用户显式指定的参考范围')
    expect(user).not.toContain('当前没有用户添加的附件')
    expect(user.indexOf('用户诉求：')).toBeLessThan(user.indexOf('偏好：'))
    expect(user.indexOf('偏好：')).toBeLessThan(user.indexOf('默认工作区：'))
    expect(user.indexOf('默认工作区：')).toBeLessThan(user.indexOf('用户@的参考资料：'))
    expect(user.indexOf('用户@的参考资料：')).toBeLessThan(user.indexOf('当前时间：'))
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
