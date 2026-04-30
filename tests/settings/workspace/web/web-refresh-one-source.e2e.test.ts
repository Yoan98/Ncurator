import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  seedWebSources,
  setSettingsE2EApiOverrides,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('web-refresh-one-source', async () => {
    await runE2ECase({
      caseId: 'web-refresh-one-source',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '单条网页资料重新抓取时展示刷新中状态，并在成功后刷新最近抓取时间。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceId = ''
        let refreshingStatusVisible = false

        await runtime.step({
          name: 'seed-web-source',
          message: '预置工作区与一条网页资料，注入抓取延迟，并进入工作区详情。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-refresh-one-workspace',
              name: '网页资料工作区'
            })
            workspaceId = workspace.workspace!.id
            await seedWebSources(page, workspaceId, ['https://example.com/refresh-one-source'])
            await setSettingsE2EApiOverrides(page, {
              webSourceRefreshDelayMs: 1200
            })
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspaceId).click()
            await getSettingsLocator(
              page,
              `${importSelectors.webSourceRefreshButtonPrefix}-e2e-web-source-1`
            ).waitFor({ state: 'visible' })
          }
        })

        const initialFetchedAt = await page.evaluate(async (selectedWorkspaceId) => {
          const response = await window.api.webSourceList({
            workspaceId: selectedWorkspaceId
          })
          return response.items.find((item) => item.id === 'e2e-web-source-1')?.fetched_at || 0
        }, workspaceId)

        await runtime.step({
          name: 'refresh-current-web-source',
          message: '触发当前网页资料重新抓取，并观察执行中与成功后的页面反馈。',
          run: async () => {
            await getSettingsLocator(
              page,
              `${importSelectors.webSourceRefreshButtonPrefix}-e2e-web-source-1`
            ).click()
            await page.getByText('处理中').first().waitFor({ state: 'visible' })
            refreshingStatusVisible = true
            await page.waitForFunction(async ([previousFetchedAt, selectedWorkspaceId]) => {
              const response = await window.api.webSourceList({
                workspaceId: String(selectedWorkspaceId || '')
              })
              const currentFetchedAt =
                response.items.find((item) => item.id === 'e2e-web-source-1')?.fetched_at || 0
              return currentFetchedAt > Number(previousFetchedAt || 0)
            }, [initialFetchedAt, workspaceId])
            await page.getByText('已抓取').first().waitFor({ state: 'visible' })
          }
        })

        const refreshedFetchedAt = await page.evaluate(async (selectedWorkspaceId) => {
          const response = await window.api.webSourceList({
            workspaceId: selectedWorkspaceId
          })
          return response.items.find((item) => item.id === 'e2e-web-source-1')?.fetched_at || 0
        }, workspaceId)

        return {
          initialFetchedAt,
          refreshedFetchedAt,
          refreshingStatusVisible,
          fetchedLabelVisible: await page.getByText('最近抓取').first().isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.refreshingStatusVisible, {
          name: 'single-refresh-shows-in-progress-status',
          message: '单条抓取执行中，当前网页资料应显示刷新中的状态，对齐 SET-WEB-003-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.refreshedFetchedAt > result.initialFetchedAt && result.fetchedLabelVisible,
          {
            name: 'single-refresh-updates-fetched-time',
            message: '抓取成功后，最近抓取时间和状态都应刷新，对齐 SET-WEB-003-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
