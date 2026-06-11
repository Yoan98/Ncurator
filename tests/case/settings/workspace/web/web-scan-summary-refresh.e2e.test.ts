import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  navigateToSettingsSection,
  seedWebSources,
  waitForWebIndexJobIdle,
  workspaceCardLocator
} from '../../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it(
    'web-scan-summary-refresh',
    async () => {
      await runE2ECase({
        caseId: 'web-scan-summary-refresh',
        domain: 'settings',
        suite: 'workspace',
        groups: ['web'],
        description: '点击检查更新后，网页列表状态会刷新为可索引，并同步更新摘要统计。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceId = ''
          let progressVisible = false
          let buttonsDisabled = false

          await runtime.step({
            name: 'seed-web-source',
            message: '预置工作区与一条网页资料，进入网页 tab。',
            run: async () => {
              const workspace = await createFixtureWorkspace(page, {
                rootPath: '/tmp/settings-web-scan-summary-refresh',
                name: '网页检查工作区'
              })
              workspaceId = workspace.workspace!.id
              await seedWebSources(page, workspaceId, ['https://example.com/scan-summary-refresh'])
              await navigateToSettingsSection(page, 'workspace')
              await workspaceCardLocator(page, workspaceId).click()
              await page.getByRole('tab', { name: '网页 1' }).click()
            }
          })

          await runtime.step({
            name: 'scan-web-sources',
            message: '点击检查更新，确认网页状态与摘要切换到可索引。',
            run: async () => {
              await page.getByRole('button', { name: '检查更新' }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              progressVisible = true
              buttonsDisabled =
                (await page.getByRole('button', { name: '检查更新' }).isDisabled()) &&
                (await page.getByRole('button', { name: '更新索引' }).isDisabled())
              await waitForWebIndexJobIdle(page, workspaceId)
            }
          })

          const webList = await page.evaluate(async (selectedWorkspaceId) => {
            return await window.api.webSourceList({
              workspaceId: String(selectedWorkspaceId || '')
            })
          }, workspaceId)

          return {
            progressVisible,
            buttonsDisabled,
            summary: webList.summary,
            statuses: webList.items.map((item) => item.index_status)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.progressVisible && result.buttonsDisabled, {
            name: 'scan-web-progress-is-visible',
            message: '网页检查执行中应展示持久化进度并禁用两个索引操作按钮，对齐 SET-WEB-003-AC1。',
            data: result
          })

          await runtime.assertThat(
            result.summary.needs_index_count === 1 && result.statuses.includes('needs_index'),
            {
              name: 'scan-refreshes-web-summary-and-status',
              message:
                '检查更新成功后，网页摘要中的可索引数和列表项状态都应同步刷新，对齐 SET-WEB-003-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_WEB_E2E_TIMEOUT_MS
  )
})
