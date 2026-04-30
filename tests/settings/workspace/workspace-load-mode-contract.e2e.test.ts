import { describe, it } from 'vitest'
import type { WorkspacePrepareMode } from '../../../src/shared/types'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace
} from '../../harness/e2e/settings'

const MODES: readonly WorkspacePrepareMode[] = ['full', 'presence_only', 'changes_only']

describe('settings workspace e2e', () => {
  it('workspace-load-mode-contract', async () => {
    await runE2ECase({
      caseId: 'workspace-load-mode-contract',
      domain: 'settings',
      suite: 'workspace',
      description: '工作空间加载接口会把当前模式原样带入请求，并返回可刷新页面的完成态载荷。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const workspace = await createFixtureWorkspace(page, {
          rootPath: '/tmp/settings-workspace-load-mode-contract',
          name: '加载契约工作区'
        })

        const responses = await page.evaluate(
          async (input: { workspaceId: string; modes: WorkspacePrepareMode[] }) => {
            const results = []
            for (const mode of input.modes) {
              results.push(await window.api.workspacePrepare({ workspaceId: input.workspaceId, mode }))
            }
            return results
          },
          { workspaceId: workspace.workspace!.id, modes: [...MODES] }
        )

        const workspaceList = await page.evaluate(async () => {
          return await window.api.workspaceList()
        })

        return {
          modes: responses.map((item) => item.progress?.mode || null),
          phases: responses.map((item) => item.progress?.phase || null),
          workspace: workspaceList.items[0] || null
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(JSON.stringify(result.modes) === JSON.stringify([...MODES]), {
          name: 'workspace-prepare-keeps-selected-mode',
          message:
            'full、presence_only、changes_only 三种模式都应原样进入实际加载请求，对齐 SET-WORKSPACE-004-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.phases.every((phase) => phase === 'complete') &&
            result.workspace?.status === 'prepared' &&
            typeof result.workspace?.last_prepare_at === 'number',
          {
            name: 'workspace-prepare-returns-refreshable-complete-state',
            message:
              '加载成功后，返回结果和列表数据源都应包含最近加载时间与状态信息，对齐 SET-WORKSPACE-004-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
