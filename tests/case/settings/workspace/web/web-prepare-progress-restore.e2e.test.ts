import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  navigateToSettingsSection,
  seedWebSources,
  startLocalSettingsHttpServer,
  workspaceCardLocator
} from '../../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it(
    'web-prepare-progress-restore',
    async () => {
      await runE2ECase({
        caseId: 'web-prepare-progress-restore',
        domain: 'settings',
        suite: 'workspace',
        groups: ['web'],
        description: '网页索引执行中离开并返回工作空间页后，应恢复分阶段持久化进度。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceId = ''
          let restoredProgressVisible = false
          let restoredButtonsDisabled = false
          let restoredActiveJob = false
          let restoredStepText = ''
          let restoredScanProgressVisible = false
          let restoredScanButtonsDisabled = false
          const httpServer = await startLocalSettingsHttpServer({
            '/web-restore': {
              body: '<html><head><title>Web Restore</title></head><body>Delayed local web fixture.</body></html>',
              delayMs: 5_000
            }
          })

          runtime.registerResource({
            name: 'settings-http-server',
            phase: 'before-app-close',
            dispose: httpServer.close
          })

          await runtime.step({
            name: 'seed-delayed-web-sources',
            message: '创建延迟响应的本地真实网页并进入工作区网页 tab。',
            run: async () => {
              const workspace = await createFixtureWorkspace(page, {
                rootPath: '/tmp/ncurator-e2e-settings-web-prepare-delay-restore',
                name: '网页进度恢复工作区'
              })
              workspaceId = workspace.workspace!.id
              await seedWebSources(page, workspaceId, [httpServer.url('/web-restore')])
              await navigateToSettingsSection(page, 'workspace')
              await workspaceCardLocator(page, workspaceId).click()
              await page.getByRole('tab', { name: '网页 1' }).click()
              await page.getByRole('button', { name: '检查更新', exact: true }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await workspaceCardLocator(page, workspaceId).click()
              await page.getByRole('tab', { name: '网页 1' }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              restoredScanProgressVisible = await page
                .getByTestId(importSelectors.webSourceIndexJobProgress)
                .isVisible()
              restoredScanButtonsDisabled =
                (await page.getByRole('button', { name: '检查更新', exact: true }).isDisabled()) &&
                (await page.getByRole('button', { name: '更新索引', exact: true }).isDisabled())
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'hidden',
                timeout: SETTINGS_WEB_E2E_TIMEOUT_MS
              })
              await page.getByRole('button', { name: '更新索引', exact: true }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              await page
                .getByTestId(importSelectors.webSourceIndexJobProgress)
                .getByText('步骤 1/2 抓取网页', { exact: true })
                .waitFor({ state: 'visible' })
            }
          })

          await runtime.step({
            name: 'restore-web-progress-after-route-change',
            message: '切到其他设置页再返回网页 tab，确认 active job 进度仍可恢复。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await workspaceCardLocator(page, workspaceId).click()
              await page.getByRole('tab', { name: '网页 1' }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              const activeJobResponse = await page.evaluate(async (selectedWorkspaceId) => {
                return await window.api.workspaceIndexJobGet({
                  workspaceId: String(selectedWorkspaceId || ''),
                  sourceKind: 'web'
                })
              }, workspaceId)
              restoredStepText =
                (await page.getByTestId(importSelectors.webSourceIndexJobProgress).innerText()) ||
                ''
              restoredProgressVisible = await page
                .getByTestId(importSelectors.webSourceIndexJobProgress)
                .isVisible()
              restoredButtonsDisabled =
                (await page.getByRole('button', { name: '检查更新', exact: true }).isDisabled()) &&
                (await page.getByRole('button', { name: '更新索引', exact: true }).isDisabled())
              restoredActiveJob =
                activeJobResponse.success && activeJobResponse.job?.status === 'running'
            }
          })

          await page.waitForFunction(async (selectedWorkspaceId) => {
            const response = await window.api.webSourceList({
              workspaceId: String(selectedWorkspaceId || '')
            })
            return response.items.every((item) => item.index_status === 'indexed')
          }, workspaceId)

          return {
            restoredProgressVisible,
            restoredButtonsDisabled,
            restoredActiveJob,
            restoredStepText,
            restoredScanProgressVisible,
            restoredScanButtonsDisabled
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.restoredScanProgressVisible && result.restoredScanButtonsDisabled,
            {
              name: 'web-scan-progress-restores-after-return',
              message:
                '网页检查更新执行中离开并返回网页 tab 后，应恢复进度并继续禁用两个按钮，对齐 SET-WEB-003-AC3。',
              data: result
            }
          )
          await runtime.assertThat(
            result.restoredProgressVisible &&
              result.restoredButtonsDisabled &&
              result.restoredActiveJob &&
              /步骤 [12]\/2/.test(result.restoredStepText),
            {
              name: 'web-progress-restores-after-return',
              message:
                '离开并返回网页 tab 后，应通过持久化 running job 恢复分阶段进度并继续禁用两个按钮，对齐 SET-WEB-004-AC5。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_WEB_E2E_TIMEOUT_MS
  )
})
