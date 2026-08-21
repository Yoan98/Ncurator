import { describe, expect, it } from 'vitest'
import { normalizeHumanThought } from '../../../../src/main/services/ai/human/memory/thoughtMemory'
import type { HumanThought } from '../../../../src/main/services/ai/human/types'

describe('ai unit thought memory normalize', () => {
  it('normalizes next and omits optional fields when missing', () => {
    expect(
      normalizeHumanThought({
        next: '  继续推进  \r\n'
      })
    ).toEqual({
      next: '继续推进'
    })
  })

  it('normalizes progressOverview when present', () => {
    expect(
      normalizeHumanThought({
        next: '更新推进总览',
        progressOverview: '第一行  \r\n第二行\t \r\n'
      })
    ).toEqual({
      next: '更新推进总览',
      progressOverview: '第一行\n第二行'
    })
  })

  it('keeps an explicit empty todolist as an empty array', () => {
    expect(
      normalizeHumanThought({
        next: '清空行动路径',
        todolist: []
      })
    ).toEqual({
      next: '清空行动路径',
      todolist: []
    })
  })

  it('trims empty todolist items and whitespace', () => {
    expect(
      normalizeHumanThought({
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
      })
    ).toEqual({
      next: '更新行动路径',
      todolist: [
        {
          item: '已完成核对',
          status: 'done'
        }
      ]
    })
  })

  it('omits progressOverview when it is not a string', () => {
    const thought: HumanThought = {
      next: '保持现状'
    }
    expect(normalizeHumanThought(thought)).toEqual({ next: '保持现状' })
  })
})
