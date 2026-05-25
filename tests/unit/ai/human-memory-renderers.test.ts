import { describe, expect, it } from 'vitest'
import {
  renderHumanThought,
  renderTaskProgress
} from '../../../src/main/services/ai/human/shared/memoryRenderers'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'
import { appendRoundRecord, buildHandExecution } from '../../../src/main/services/ai/human/memory/rounds'
import { renderBrainRoundExecutionOnly } from '../../../src/main/services/ai/human/shared/historyRenderers'

describe('ai unit human memory renderers', () => {
  it('renders thought as global progress only without thought.next', () => {
    const state = createInitialHumanState({
      taskId: 'task-thought-render',
      userInput: '继续推进'
    })

    state.memory.thought = {
      next: '这一轮判断不应显示在 thought 区块',
      todolist: [
        {
          item: '核对工作区文件',
          status: 'todo'
        }
      ],
      progressionSummary: '已经建立任务推进基线。'
    }

    const text = renderHumanThought(state, 'brain_prompt')

    expect(text).toContain('待办路径：')
    expect(text).toContain('推进摘要：')
    expect(text).toContain('核对工作区文件')
    expect(text).toContain('已经建立任务推进基线。')
    expect(text).not.toContain('当前与下一步：')
    expect(text).not.toContain('这一轮判断不应显示在 thought 区块')
  })

  it('renders task_progress with latest decision and execution in fixed format', () => {
    const initialState = createInitialHumanState({
      taskId: 'task-progress-render',
      userInput: '继续推进'
    })

    initialState.memory.thought = {
      next: '旧 thought.next 不应直接作为 task_progress 主体',
      todolist: [
        {
          item: '核对工作区文件',
          status: 'todo'
        }
      ],
      progressionSummary: '已经建立任务推进基线。'
    }

    const taskRun = appendRoundRecord({
      state: initialState,
      thought: {
        thought: {
          next: '先读取 release-note.txt 确认最新状态'
        },
        nextAction: {
          action: 'hand',
          calls: [
            {
              toolName: 'terminal_run',
              args: {
                command: 'cat release-note.txt'
              }
            }
          ]
        }
      },
      execution: buildHandExecution({
        calls: [
          {
            toolName: 'terminal_run',
            args: {
              command: 'cat release-note.txt'
            }
          }
        ],
        toolResults: [
          {
            toolName: 'terminal_run',
            ok: true,
            code: 'ok',
            data: {
              ok: true,
              code: 'ok',
              combinedOutput: 'latest release status',
              command: 'cat release-note.txt',
              exitCode: 0,
              timedOut: false
            }
          }
        ]
      }),
      createdAt: 1
    })

    const state = {
      ...initialState,
      memory: {
        ...initialState.memory,
        taskRun
      }
    }
    const latestRound = state.memory.taskRun.rounds.at(-1)
    const text = renderTaskProgress({
      state,
      latestRound,
      latestExecutionText: renderBrainRoundExecutionOnly(latestRound),
      mode: 'brain_prompt'
    })

    expect(text).toContain('最新一轮决策如下')
    expect(text).toContain('待办路径：')
    expect(text).toContain('推进摘要：')
    expect(text).toContain('判断：')
    expect(text).toContain('执行：')
    expect(text).toContain('核对工作区文件')
    expect(text).toContain('已经建立任务推进基线。')
    expect(text).toContain('先读取 release-note.txt 确认最新状态')
    expect(text).toContain('类型：hand')
    expect(text).toContain('latest release status')
    expect(text).not.toContain('旧 thought.next 不应直接作为 task_progress 主体')
  })
})
