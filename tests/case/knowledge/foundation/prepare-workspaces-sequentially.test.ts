import { describe, it } from 'vitest'
import { prepareWorkspacesSequentially } from '../../../../src/shared/prepareWorkspacesSequentially'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge foundation', () => {
  it('prepare-workspaces-sequentially', async () => {
    await runBackendCase({
      caseId: 'prepare-workspaces-sequentially',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '多地址更新索引按顺序等待前一个完成再启动下一个。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const events: string[] = []
        const results = await prepareWorkspacesSequentially(
          ['ws-a', 'ws-b', 'ws-c'],
          async (workspaceId) => {
            events.push(`start:${workspaceId}`)
            await Promise.resolve()
            events.push(`end:${workspaceId}`)
            return workspaceId
          }
        )
        return { results, events }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.results.join(',') === 'ws-a,ws-b,ws-c' &&
            result.events.join(',') ===
              'start:ws-a,end:ws-a,start:ws-b,end:ws-b,start:ws-c,end:ws-c',
          {
            name: 'prepare-is-sequential',
            message: '多地址更新索引必须等前一个完成后再启动下一个，对齐 SET-WORKSPACE-004-AC11。',
            data: result
          }
        )
      }
    })
  })
})
