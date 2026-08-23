import { describe, expect, it } from 'vitest'
import {
  buildBrainSystemPrompt,
  buildBrainUserMessage
} from '../../../../src/main/services/ai/human/prompts/brain'
import { createInitialHumanState } from '../../../../src/main/services/ai/human/state/schema'
import type { AiRunContext } from '../../../../src/main/services/ai/types'

const createFakeCtx = (): AiRunContext =>
  ({
    platform: 'macos',
    runId: 'run-cache-stability',
    sessionId: 'session-cache-stability',
    runStartedAt: 0,
    preference: 'default',
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

const buildStateWithPlan = () => {
  const state = createInitialHumanState({
    taskId: 'task-cache-stability',
    userInput: '继续处理资料'
  })
  state.memory.plan = [{ title: '读取当前目录', status: 'done' }]
  state.skills.learnedSkillIds = ['docx-read']
  return state
}

describe('ai unit brain prompt cache stability', () => {
  it('renders byte-identical output for the same state', () => {
    const state = buildStateWithPlan()
    const ctx = createFakeCtx()

    const firstSystem = buildBrainSystemPrompt({ ctx })
    const secondSystem = buildBrainSystemPrompt({ ctx })
    const firstUser = buildBrainUserMessage({ state, ctx, injectPlan: true })
    const secondUser = buildBrainUserMessage({ state, ctx, injectPlan: true })

    expect(secondSystem).toBe(firstSystem)
    expect(secondUser).toBe(firstUser)
  })

  it('keeps the system prompt static across tasks', () => {
    const stateA = createInitialHumanState({ taskId: 'task-a', userInput: '任务 A' })
    const stateB = createInitialHumanState({ taskId: 'task-b', userInput: '任务 B' })
    const ctx = createFakeCtx()

    const aSystem = buildBrainSystemPrompt({ ctx })
    const bSystem = buildBrainSystemPrompt({ ctx })

    expect(aSystem).toBe(bSystem)

    const aUser = buildBrainUserMessage({ state: stateA, ctx })
    const bUser = buildBrainUserMessage({ state: stateB, ctx })
    expect(aUser).not.toBe(bUser)
    expect(aUser).toContain('任务 A')
    expect(bUser).toContain('任务 B')
  })

  it('keeps system static across tasks and embeds platform and runtime paths', () => {
    const ctx = createFakeCtx()

    const system = buildBrainSystemPrompt({ ctx })

    expect(system).toContain('platform：macos')
    expect(system).toContain('runtime_paths.assets：')
    expect(system).toContain('runtime_paths.scripts：')
  })
})
