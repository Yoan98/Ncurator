import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-open-path-contract', async () => {
    await runE2ECase({
      caseId: 'workspace-open-path-contract',
      domain: 'settings',
      suite: 'workspace',
      description: '点击打开路径时，会以当前工作空间根目录触发 revealPath 调用。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const workspace = await createFixtureWorkspace(page, {
          rootPath: '/tmp/settings-workspace-open-path-contract',
          name: '打开路径工作区'
        })

        await setSettingsE2EApiOverrides(page, {
          revealPathResponseByPath: {
            '/tmp/settings-workspace-open-path-contract': {
              success: true
            }
          }
        })

        await navigateToSettingsSection(page, 'workspace')
        await getSettingsLocator(page, importSelectors.workspaceOpenPathButton).click()
        const signals = await runtime.collectSignals()

        return {
          revealCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'revealPath'),
          expectedPath: workspace.workspace?.root_path || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.revealCalls.some((entry) => entry.payload === result.expectedPath),
          {
            name: 'workspace-open-path-uses-selected-root-path',
            message:
              '打开路径时，应以当前工作空间根目录作为 revealPath 参数，对齐 SET-WORKSPACE-006-AC1。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
