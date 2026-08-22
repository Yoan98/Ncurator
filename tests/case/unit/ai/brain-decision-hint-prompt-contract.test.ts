import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildBrainSystemPrompt,
  buildBrainUserMessage
} from '../../../../src/main/services/ai/human/prompts/brain'
import {
  renderDecisionHintDetail,
  renderDecisionHintForBrain
} from '../../../../src/main/services/ai/human/prompts/decisionHints'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (preference: AiRunContext['preference'] = 'default'): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-1',
    sessionId: 'session-1',
    runStartedAt: 0,
    preference,
    workspace: {
      workspaceId: 'ws-1',
      workspaceName: '测试工作区',
      rootPath: '/tmp/workspace'
    },
    referenceScope: {
      workspace: {
        id: 'ws-1',
        rootPath: '/tmp/workspace'
      },
      selectedReferences: []
    }
  }) as AiRunContext

describe('ai unit brain decision-hint prompt contract', () => {
  it('renders default, relaxed and strict local source preferences', () => {
    const state = createInitialHumanState({
      taskId: 'task-preference',
      userInput: '按当前偏好处理'
    })

    const defaultPrompt = buildBrainUserMessage({ state, ctx: createFakeCtx('default') })
    const relaxedPrompt = buildBrainUserMessage({
      state,
      ctx: createFakeCtx('local_sources_relaxed')
    })
    const strictPrompt = buildBrainUserMessage({
      state,
      ctx: createFakeCtx('local_sources_strict')
    })

    const defaultPreference =
      defaultPrompt.match(/<preference>([\s\S]*?)<\/preference>/)?.[1].trim() || ''
    expect(defaultPreference).toBe('无')
    expect(relaxedPrompt).toContain('优先使用知识库内容和用户工作区域文件内容作为依据来推进任务')
    expect(strictPrompt).toContain('必须只能使用知识库内容和用户工作区域文件内容作为依据来推进任务')
    expect(strictPrompt).toContain('禁止使用其他信息与模型能力本身的信息')
  })

  it('renders static local environment with run start time in system', () => {
    const ctx = createFakeCtx()
    const system = buildBrainSystemPrompt({ ctx })
    const environmentSection =
      system.match(/<local_environment>([\s\S]*?)<\/local_environment>/)?.[1] || ''

    expect(environmentSection).toContain('platform：macos')
    expect(environmentSection).toContain(
      `runtime_paths.assets：${path.resolve('/tmp/workspace/.ncurator/runtime/assets')}`
    )
    expect(environmentSection).toContain(
      `runtime_paths.scripts：${path.resolve('/tmp/workspace/.ncurator/runtime/scripts')}`
    )
    expect(environmentSection).toMatch(/current_time\.timezone：.+/)
    expect(environmentSection).toMatch(
      /current_time\.local_iso：\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}/
    )
    expect(system).not.toContain('utc_iso')
    expect(system).not.toContain('<runtime_environment>')
  })

  it('orders user blocks stable-first and keeps dynamic blocks last for prefix caching', () => {
    const state = createInitialHumanState({
      taskId: 'task-order',
      userInput: '继续处理资料'
    })

    const prompt = buildBrainUserMessage({
      state,
      ctx: createFakeCtx(),
      compactedHistoryText: '已压缩的历史'
    })

    const indexOf = (tag: string): number => prompt.indexOf(`<${tag}>`)
    const stableHeadOrder = ['task_goal', 'preference', 'reference_scope', 'compacted_history', 'current_state']
    const indexes = stableHeadOrder.map((tag) => indexOf(tag))
    const sorted = [...indexes].sort((a, b) => a - b)

    expect(indexes.every((value) => value >= 0)).toBe(true)
    expect(indexes).toEqual(sorted)
  })

  it('renders plan and learned skills inside current_state', () => {
    const state = createInitialHumanState({
      taskId: 'task-1',
      userInput: '继续处理 docx'
    })
    state.memory.plan = [
      { title: '修正文档写入', status: 'todo' },
      { title: '检查是否满足诉求', status: 'done', evidence: '已完成' }
    ]
    state.skills.learnedSkillIds = ['docx-read', 'docx-write']

    const prompt = buildBrainUserMessage({ state, ctx: createFakeCtx(), injectPlan: true })

    const currentState = prompt.match(/<current_state>([\s\S]*?)<\/current_state>/)?.[1] || ''
    expect(currentState).toContain('[todo] 修正文档写入')
    expect(currentState).toContain('[done] 检查是否满足诉求（已完成）')
    expect(currentState).toContain('- docx-read')
    expect(currentState).toContain('- docx-write')
  })

  it('renders compacted_history only when provided', () => {
    const state = createInitialHumanState({
      taskId: 'task-2',
      userInput: '继续处理资料'
    })

    const withHistory = buildBrainUserMessage({
      state,
      ctx: createFakeCtx(),
      compactedHistoryText: '此前已完成资料读取。'
    })
    const withoutHistory = buildBrainUserMessage({ state, ctx: createFakeCtx() })

    expect(withHistory).toContain('<compacted_history>')
    expect(withHistory).toContain('此前已完成资料读取。')
    expect(withoutHistory).not.toContain('<compacted_history>')
  })

  it('requires references disclosure when delivering through mouth', () => {
    const system = buildBrainSystemPrompt({ ctx: createFakeCtx() })

    expect(system).toContain('finish')
    expect(system).toContain('evidenceReferences')
    expect(system).toContain('usedFor')
    expect(system).toContain('支撑了最终交付的哪些地方')
    expect(system).toContain('resourceType 为 file 或 web')
    expect(system).toContain('禁止把不可追溯的地址或无法使用的资料放入 evidenceReferences')
  })

  it('does not render removed history blocks in the user message', () => {
    const state = createInitialHumanState({
      taskId: 'task-3',
      userInput: '继续处理资料'
    })

    const user = buildBrainUserMessage({ state, ctx: createFakeCtx() })

    expect(user).toContain('<current_state>')
    expect(user).not.toContain('<conversation_history>')
    expect(user).not.toContain('<round_history>')
    expect(user).not.toContain('<rounds>')
    expect(user).not.toContain('<resume_messages>')
    expect(user).not.toContain('<todolist>')
    expect(user).not.toContain('<summary>')
    expect(user).not.toContain('<recent_turns>')
    expect(user).not.toContain('待办路径：')
  })

  it('renders decision hints for brain without throwing', () => {
    const summary = renderDecisionHintForBrain({
      code: 'brain_plan_incomplete',
      detail: { pendingItems: ['检查是否已经满足用户诉求'] }
    })
    const detail = renderDecisionHintDetail({
      code: 'brain_plan_incomplete',
      detail: { pendingItems: ['检查是否已经满足用户诉求'] }
    })

    expect(summary).toContain('检查是否已经满足用户诉求')
    expect(summary).toContain('仍有未完成事项')
    expect(detail).toEqual({ pendingItems: ['检查是否已经满足用户诉求'] })
  })
})
