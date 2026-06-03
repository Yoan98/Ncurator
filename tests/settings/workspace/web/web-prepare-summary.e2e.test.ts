import { describe, it } from 'vitest'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('web-prepare-summary', async () => {
    await runE2ECase({
      caseId: 'web-prepare-summary',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '更新网页索引后，会区分已索引与爬取失败结果，并刷新摘要统计。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceId = ''

        await runtime.step({
          name: 'seed-web-sources',
          message: '预置一条可成功索引网页和一条会爬取失败的网页，进入网页 tab。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-prepare-summary',
              name: '网页索引工作区'
            })
            workspaceId = workspace.workspace!.id
            await seedWebSources(page, workspaceId, [
              'https://example.com/prepare-success',
              'https://refresh-fail.example.com/refresh-fail'
            ])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspaceId).click()
            await page.getByRole('tab', { name: '网页 2' }).click()
            await page.getByRole('button', { name: '检查更新' }).click()
            await page.waitForFunction(async (selectedWorkspaceId) => {
              const response = await window.api.webSourceList({
                workspaceId: String(selectedWorkspaceId || '')
              })
              return response.summary.needs_index_count === 2
            }, workspaceId)
          }
        })

        await runtime.step({
          name: 'prepare-web-sources',
          message: '点击更新索引，确认成功和失败结果都被写回列表状态。',
          run: async () => {
            await page.getByRole('button', { name: '更新索引' }).click()
            await page.waitForFunction(async (selectedWorkspaceId) => {
              const response = await window.api.webSourceList({
                workspaceId: String(selectedWorkspaceId || '')
              })
              return (
                response.summary.failed_count === 1 &&
                response.items.some((item) => item.index_status === 'indexed') &&
                response.items.some((item) => item.index_status === 'crawl_failed')
              )
            }, workspaceId)
          }
        })

        const webList = await page.evaluate(async (selectedWorkspaceId) => {
          return await window.api.webSourceList({
            workspaceId: String(selectedWorkspaceId || '')
          })
        }, workspaceId)

        return {
          summary: webList.summary,
          statuses: webList.items.map((item) => item.index_status)
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.statuses.includes('indexed') && result.summary.needs_index_count === 0,
          {
            name: 'prepare-updates-successful-web-sources',
            message:
              '更新索引成功后，已成功处理的网页应转为已索引，并刷新摘要统计，对齐 SET-WEB-004-AC2。',
            data: result
          }
        )

        await runtime.assertThat(
          result.statuses.includes('crawl_failed') && result.summary.failed_count === 1,
          {
            name: 'prepare-distinguishes-crawl-failures',
            message:
              '更新索引失败时，应明确区分爬取失败并写回失败数量，对齐 SET-WEB-004-AC3。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
