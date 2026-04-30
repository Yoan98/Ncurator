import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  seedWebSources,
  setSettingsE2EApiOverrides,
  workspaceCardLocator
} from '../../harness/e2e/settings'

describe('settings web e2e', () => {
  it('web-open-url-contract', async () => {
    await runE2ECase({
      caseId: 'web-open-url-contract',
      domain: 'settings',
      suite: 'web',
      description: '点击网页资料 URL 时，应通过 openExternal 打开原网页地址。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const targetUrl = 'https://example.com/open-url-contract'
        const workspace = await createFixtureWorkspace(page, {
          rootPath: '/tmp/settings-web-open-url-contract',
          name: '外链打开工作区'
        })
        await seedWebSources(page, workspace.workspace!.id, [targetUrl])
        await setSettingsE2EApiOverrides(page, {
          openExternalResponseByUrl: {
            [targetUrl]: {
              success: true
            }
          }
        })

        await navigateToSettingsSection(page, 'workspace')
        await workspaceCardLocator(page, workspace.workspace!.id).click()
        await getSettingsLocator(page, importSelectors.webSourceUrlLinkButton).click()
        const signals = await runtime.collectSignals()

        return {
          openExternalCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'openExternal'),
          targetUrl
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.openExternalCalls.some((entry) => entry.payload === result.targetUrl),
          {
            name: 'web-url-opens-original-url',
            message:
              '点击网页资料 URL 时，应调用 openExternal 打开原网页地址，而不是进入本地预览路径，对齐 SET-WEB-005-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
