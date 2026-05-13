import { describe, expect, it } from 'vitest'
import { applyThoughtPatch } from '../../../src/main/services/ai/human/memory/thoughtMemory'
import type { HumanThought } from '../../../src/main/services/ai/human/types'

const BASE_THOUGHT: HumanThought = {
  next: '已有下一步',
  progressionSummary: '已有推进摘要',
  todolist: [
    {
      item: '继续核对',
      status: 'todo'
    }
  ]
}

describe('ai unit thought memory patch', () => {
  it('keeps the original thought memory when optional fields are missing', () => {
    expect(
      applyThoughtPatch({
        memory: BASE_THOUGHT,
        thought: {
          next: '继续推进'
        }
      })
    ).toEqual({
      ...BASE_THOUGHT,
      next: '继续推进'
    })
  })

  it('overwrites only the returned thought memory fields', () => {
    expect(
      applyThoughtPatch({
        memory: BASE_THOUGHT,
        thought: {
          next: '更新推进摘要',
          progressionSummary: '新的推进摘要'
        }
      })
    ).toEqual({
      next: '更新推进摘要',
      progressionSummary: '新的推进摘要',
      todolist: [
        {
          item: '继续核对',
          status: 'todo'
        }
      ]
    })
  })

  it('clears todolist when thought explicitly returns an empty array', () => {
    expect(
      applyThoughtPatch({
        memory: BASE_THOUGHT,
        thought: {
          next: '清空行动路径',
          todolist: []
        }
      })
    ).toEqual({
      next: '清空行动路径',
      progressionSummary: '已有推进摘要',
      todolist: []
    })
  })

  it('normalizes line endings and trims trailing whitespace for patched text', () => {
    expect(
      applyThoughtPatch({
        memory: BASE_THOUGHT,
        thought: {
          next: '更新文本  \r\n',
          progressionSummary: '第一行  \r\n第二行\t \r\n'
        }
      })
    ).toEqual({
      next: '更新文本',
      progressionSummary: '第一行\n第二行',
      todolist: [
        {
          item: '继续核对',
          status: 'todo'
        }
      ]
    })
  })

  it('trims empty todolist items when overwriting the full list', () => {
    expect(
      applyThoughtPatch({
        memory: BASE_THOUGHT,
        thought: {
          next: '更新行动路径',
          todolist: [
            {
              item: '  已完成核对  ',
              status: 'done'
            },
            {
              item: '   ',
              status: 'todo'
            }
          ]
        }
      })
    ).toEqual({
      next: '更新行动路径',
      progressionSummary: '已有推进摘要',
      todolist: [
        {
          item: '已完成核对',
          status: 'done'
        }
      ]
    })
  })
})
