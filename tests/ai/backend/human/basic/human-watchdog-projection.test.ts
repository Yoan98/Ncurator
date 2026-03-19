import { projectWorkbenchState } from '../../../../../src/renderer/src/utils/workbenchProjection'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { defineAiHumanCase } from '../helpers'

defineAiHumanCase({
  caseId: 'human-watchdog-projection',
  caseType: 'basic',
  groups: ['basic'],
  description: 'workbench projection 应把 watchdog_signal 投影成可见时间线项。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async () => {
    const events: AiRunEvent[] = [
      {
        type: 'run_started',
        runId: 'projection-run',
        sessionId: 'projection-session',
        input: 'test',
        createdAt: 1
      },
      {
        type: 'watchdog_signal',
        runId: 'projection-run',
        taskId: 'projection-task',
        level: 'warn',
        summary: '最近多轮没有新增事实，建议收敛。',
        signs: ['repeated_plan'],
        createdAt: 2,
        stage: 'human_reason'
      }
    ]

    return projectWorkbenchState({
      aiEvents: events,
      aiPlan: [],
      searchTurn: null
    })
  },
  assert: async (projection, runtime) => {
    runtime.assertThat(
      projection.timeline.some(
        (item) =>
          item.kind === 'watchdog' &&
          item.title === 'Watchdog 提示' &&
          item.badge === 'warn'
      ),
      {
        name: 'human-watchdog-projection-visible',
        message: 'watchdog_signal 应投影为 workbench 时间线项'
      }
    )
  }
})
