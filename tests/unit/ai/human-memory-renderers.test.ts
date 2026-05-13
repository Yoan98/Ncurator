import { describe, expect, it } from 'vitest'
import { renderHumanThought } from '../../../src/main/services/ai/human/shared/memoryRenderers'
import { createInitialHumanState } from '../../../src/main/services/ai/human/state/schema'

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
})
