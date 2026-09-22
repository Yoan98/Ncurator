import { describe, expect, it } from 'vitest'
import {
  renderScheduledTaskListModelResult,
  renderScheduledTaskModelError,
  renderScheduledTaskMutationModelResult
} from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

describe('scheduled task model result renderer', () => {
  it('renders readable list and empty state', () => {
    expect(
      renderScheduledTaskListModelResult({
        toolName: 'scheduled_task_list',
        args: {},
        data: {
          tasks: [
            {
              id: 'task-1',
              name: '每日晨报',
              description: '整理事项',
              scheduleType: 'daily',
              timeOfDay: '09:00',
              weekday: null,
              enabled: true
            }
          ]
        }
      })
    ).toBe('当前伙伴的定时任务：\n1. task-1｜每日晨报｜每天 09:00｜已启用')
    expect(
      renderScheduledTaskListModelResult({
        toolName: 'scheduled_task_list',
        args: {},
        data: { tasks: [] }
      })
    ).toBe('当前伙伴没有定时任务。')
  })

  it('renders mutation confirmation and keeps domain errors', () => {
    expect(
      renderScheduledTaskMutationModelResult({
        toolName: 'scheduled_task_action',
        args: { action: 'create' },
        data: { id: 'task-1' }
      })
    ).toBe('已创建定时任务，id=task-1。')
    expect(
      renderScheduledTaskModelError({
        toolName: 'scheduled_task_action',
        args: {},
        data: { error: '请选择星期几' }
      })
    ).toBe('Error: 请选择星期几')
  })
})
