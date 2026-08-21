import { describe, expect, it } from 'vitest'
import { buildBrainPrompt } from '../../../../src/main/services/ai/human/prompts/brain'
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

const buildStateWithRound = (roundId: number) => {
  const state = createInitialHumanState({
    taskId: 'task-cache-stability',
    userInput: '继续处理资料'
  })
  state.memory.taskRun.rounds = [
    {
      roundId,
      createdAt: roundId,
      thought: {
        next: '读取当前目录建立资料范围。'
      },
      nextAction: {
        action: 'hand',
        calls: [{ toolName: 'terminal_run', args: { command: 'pwd' } }]
      },
      execution: {
        kind: 'hand',
        calls: [{ toolName: 'terminal_run', args: { command: 'pwd' } }],
        toolResults: [
          { toolName: 'terminal_run', ok: true, data: { output: '/tmp/workspace' } }
        ]
      }
    }
  ]
  return state
}

describe('ai unit brain prompt cache stability', () => {
  it('renders byte-identical output for the same state', () => {
    const state = buildStateWithRound(1)
    const ctx = createFakeCtx()

    const first = buildBrainPrompt({ state, ctx })
    const second = buildBrainPrompt({ state, ctx })

    expect(second.system).toBe(first.system)
    expect(second.user).toBe(first.user)
  })

  it('keeps the stable prefix intact when a round is appended', () => {
    const baseState = buildStateWithRound(1)
    const extendedState = buildStateWithRound(1)
    extendedState.memory.taskRun.rounds = [
      ...baseState.memory.taskRun.rounds,
      {
        roundId: 2,
        createdAt: 2,
        thought: {
          next: '补充读取工作区文件。'
        },
        nextAction: {
          action: 'hand',
          calls: [{ toolName: 'text_file_read', args: { sourcePath: 'a.md' } }]
        },
        execution: {
          kind: 'hand',
          calls: [{ toolName: 'text_file_read', args: { sourcePath: 'a.md' } }],
          toolResults: [{ toolName: 'text_file_read', ok: true, data: { content: 'x' } }]
        }
      }
    ]
    const ctx = createFakeCtx()

    const base = buildBrainPrompt({ state: baseState, ctx })
    const extended = buildBrainPrompt({ state: extendedState, ctx })

    expect(extended.system).toBe(base.system)

    const roundsTag = '<rounds>'
    const baseRoundsIndex = base.user.indexOf(roundsTag)
    const extendedRoundsIndex = extended.user.indexOf(roundsTag)

    expect(baseRoundsIndex).toBeGreaterThanOrEqual(0)
    expect(extendedRoundsIndex).toBeGreaterThanOrEqual(0)

    expect(extended.user.slice(0, extendedRoundsIndex)).toBe(base.user.slice(0, baseRoundsIndex))
    expect(extended.user).toContain('第 1 轮')
    expect(extended.user).toContain('补充读取工作区文件。')
  })

  it('keeps system static across tasks and embeds platform and runtime paths', () => {
    const stateA = createInitialHumanState({
      taskId: 'task-a',
      userInput: '任务 A'
    })
    const stateB = createInitialHumanState({
      taskId: 'task-b',
      userInput: '任务 B'
    })
    const ctx = createFakeCtx()

    const a = buildBrainPrompt({ state: stateA, ctx })
    const b = buildBrainPrompt({ state: stateB, ctx })

    expect(a.system).toBe(b.system)
    expect(a.system).toContain('platform：macos')
    expect(a.system).toContain('runtime_paths.assets：')
    expect(a.system).toContain('runtime_paths.scripts：')
    expect(a.system).toContain('new_terminal_default_path：/tmp/workspace')
  })
})
