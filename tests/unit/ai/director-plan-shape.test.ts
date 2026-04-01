import { describe, expect, it } from 'vitest'
import { toPlanTasks, validatePlannerTasks } from '../../../src/main/services/ai/director/node/helpers'

describe('ai unit director plan shape', () => {
  it('validates planner tasks and normalizes ids', () => {
    expect(
      validatePlannerTasks([
        {
          id: '',
          title: '',
          userInput: '请完成任务。'
        }
      ])
    ).toBeUndefined()

    expect(
      toPlanTasks([
        {
          id: '',
          title: '',
          userInput: '请完成任务。'
        }
      ])
    ).toEqual([
      {
        id: 'task-1',
        title: 'Task 1',
        userInput: '请完成任务。',
        status: 'ready'
      }
    ])
  })
})
