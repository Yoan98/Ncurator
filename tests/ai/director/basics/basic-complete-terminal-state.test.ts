import { describe, it } from 'vitest'
import { createCompleteNode } from '../../../../src/main/services/ai/director/node/completeNode'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createTestDirectorState } from '../testUtils'

describe('ai director basics backend', () => {
  it('basic-complete-terminal-state', async () => {
    await runBackendCase({
      caseId: 'basic-complete-terminal-state',
      domain: 'ai',
      suite: 'director',
      groups: ['basics'],
      description: '验证 director_complete 对 running 与各类终态输入的收尾规则。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const node = createCompleteNode()

        const runningPatch = await node(
          createTestDirectorState({
            status: 'running',
            directorStage: 'director_complete'
          })
        )
        const completedPatch = await node(
          createTestDirectorState({
            status: 'completed',
            directorStage: 'director_complete'
          })
        )
        const failedPatch = await node(
          createTestDirectorState({
            status: 'failed',
            directorStage: 'director_complete',
            error: 'plan_generation_failed'
          })
        )
        const cancelledPatch = await node(
          createTestDirectorState({
            status: 'cancelled',
            directorStage: 'director_complete',
            error: 'cancelled'
          })
        )

        return {
          runningPatch,
          completedPatch,
          failedPatch,
          cancelledPatch
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.runningPatch.status === 'completed' &&
            result.runningPatch.directorStage === 'director_complete',
          {
            name: 'complete-node-finalizes-running-run',
            message:
              'basic-complete-terminal-state 应把 running run 收束为 completed，并保持停留在 director_complete。',
            data: {
              runningPatch: result.runningPatch
            }
          }
        )

        runtime.assertThat(
          result.completedPatch.status === undefined &&
            result.failedPatch.status === undefined &&
            result.cancelledPatch.status === undefined &&
            result.completedPatch.directorStage === 'director_complete' &&
            result.failedPatch.directorStage === 'director_complete' &&
            result.cancelledPatch.directorStage === 'director_complete',
          {
            name: 'complete-node-does-not-overwrite-terminal-status',
            message:
              'basic-complete-terminal-state 不应覆盖已经是 completed、failed 或 cancelled 的终态 run。',
            data: {
              completedPatch: result.completedPatch,
              failedPatch: result.failedPatch,
              cancelledPatch: result.cancelledPatch
            }
          }
        )
      }
    })
  })
})
