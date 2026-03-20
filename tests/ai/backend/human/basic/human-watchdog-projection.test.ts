import { projectWorkbenchState } from '../../../../../src/renderer/src/utils/workbenchProjection'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { defineAiHumanCase } from '../helpers'

defineAiHumanCase({
  caseId: 'human-watch-hint-projection',
  caseType: 'basic',
  groups: ['basic'],
  description: 'workbench projection 应把 watch_hint 投影成可见时间线项。',
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
        type: 'watch_hint',
        runId: 'projection-run',
        taskId: 'projection-task',
        source: 'hand',
        summary: '累计工具调用次数已超限，建议优先收敛。',
        createdAt: 2,
        stage: 'human_hand'
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
          item.kind === 'watch_hint' &&
          item.title === 'Watch Hint' &&
          item.badge === 'hand'
      ),
      {
        name: 'human-watch-hint-projection-visible',
        message: 'watch_hint 应投影为 workbench 时间线项'
      }
    )
  }
})
