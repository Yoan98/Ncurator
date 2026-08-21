import { describe, expect, it } from 'vitest'
import { normalizeHumanThought } from '../../../../src/main/services/ai/human/memory/thoughtMemory'

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

  it('normalizes todo item evidence when present and drops empty evidence', () => {
    expect(
      normalizeHumanThought({
        next: '更新任务清单',
        todolist: [
          {
            item: '确认驳回行为',
            status: 'done',
            evidence: '  制度说明.docx 第 3 节明确保留原文件  \r\n'
          },
          {
            item: '补齐读取能力',
            status: 'todo',
            evidence: '   '
          }
        ]
      })
    ).toEqual({
      next: '更新任务清单',
      todolist: [
        {
          item: '确认驳回行为',
          status: 'done',
          evidence: '制度说明.docx 第 3 节明确保留原文件'
        },
        {
          item: '补齐读取能力',
          status: 'todo'
        }
      ]
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
        next: '更新任务清单',
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
      next: '更新任务清单',
      todolist: [
        {
          item: '已完成核对',
          status: 'done'
        }
      ]
    })
  })
})
