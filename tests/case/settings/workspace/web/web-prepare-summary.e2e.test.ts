import { describe, it } from 'vitest'
import type { Page } from 'playwright'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getWebSourceIndexCounts,
  navigateToSettingsSection,
  seedWebSources,
  startLocalSettingsHttpServer,
  waitForWebIndexJobIdle,
  workspaceCardLocator
} from '../../../../harness/e2e/settings'

const waitForPreparedWebSources = async (page: Page, workspaceId: string): Promise<void> => {
  const deadline = Date.now() + SETTINGS_WEB_E2E_TIMEOUT_MS
  for (;;) {
    const response = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.webSourceList({
        workspaceId: String(selectedWorkspaceId || '')
      })
    }, workspaceId)
    const prepared =
      response.summary.failed_count === 1 &&
      response.items.some((item) => item.index_status === 'indexed') &&
      response.items.some((item) => item.index_status === 'crawl_failed')
    if (prepared) return
    if (Date.now() >= deadline) {
      throw new Error('web sources did not reach prepared statuses')
    }
    await page.waitForTimeout(100)
  }
}

describe('settings workspace web e2e', () => {
  it(
    'web-prepare-summary',
    async () => {
      await runE2ECase({
        caseId: 'web-prepare-summary',
        domain: 'settings',
        suite: 'workspace',
        groups: ['web'],
        description: '更新网页索引后，会区分已索引与爬取失败结果，并刷新摘要统计。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceId = ''
          let progressVisible = false
          let buttonsDisabled = false
          let crawlStepVisible = false
          let progressText = ''
          let scanProgressVisible = false
          let scanButtonsDisabled = false
          let scanSummary: { needs_index_count: number } | null = null
          let scanStatuses: string[] = []
          const httpServer = await startLocalSettingsHttpServer({
            '/prepare-success': {
              body: '<html><head><title>Prepare Success</title></head><body>Local web fixture for indexing.</body></html>',
              delayMs: 5_000
            },
            '/refresh-fail': {
              body: '<html><head><title>Refresh First Pass</title></head><body>Available during scan.</body></html>',
              responses: [
                {
                  body: '<html><head><title>Refresh First Pass</title></head><body>Available during scan.</body></html>',
                  delayMs: 5_000
                },
                {
                  status: 500,
                  body: 'refresh failed during prepare',
                  delayMs: 5_000
                }
              ]
            }
          })

          runtime.registerResource({
            name: 'settings-http-server',
            phase: 'before-app-close',
            dispose: httpServer.close
          })

          await runtime.step({
            name: 'seed-web-sources',
            message: '预置一条本地可成功索引网页和一条本地失败网页，进入网页 tab。',
            run: async () => {
              const workspace = await createFixtureWorkspace(page, {
                rootPath: '/tmp/settings-web-prepare-summary',
                name: '网页索引工作区'
              })
              workspaceId = workspace.workspace!.id
              await seedWebSources(page, workspaceId, [
                httpServer.url('/prepare-success'),
                httpServer.url('/refresh-fail')
              ])
              await navigateToSettingsSection(page, 'workspace')
              await workspaceCardLocator(page, workspaceId).click()
              await page.getByRole('tab', { name: '网页 2' }).click()
              await page.getByRole('button', { name: '检查更新' }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              scanProgressVisible = true
              scanButtonsDisabled =
                (await page.getByRole('button', { name: '检查更新' }).isDisabled()) &&
                (await page.getByRole('button', { name: '更新索引' }).isDisabled())
              await waitForWebIndexJobIdle(page, workspaceId)
              const scanResult = await page.evaluate(async (selectedWorkspaceId) => {
                return await window.api.webSourceList({
                  workspaceId: String(selectedWorkspaceId || '')
                })
              }, workspaceId)
              scanSummary = scanResult.summary
              scanStatuses = scanResult.items.map((item) => item.index_status)
            }
          })

          await runtime.step({
            name: 'prepare-web-sources',
            message: '点击更新索引，确认成功和失败结果都被写回列表状态。',
            run: async () => {
              await page.getByRole('button', { name: '更新索引' }).click()
              await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
                state: 'visible'
              })
              const progressBlock = page.getByTestId(importSelectors.webSourceIndexJobProgress)
              await progressBlock.getByText('步骤 1/2 抓取网页', { exact: true }).waitFor({
                state: 'visible'
              })
              crawlStepVisible = true
              progressText = (await progressBlock.innerText()) || ''
              progressVisible = true
              buttonsDisabled =
                (await page.getByRole('button', { name: '检查更新' }).isDisabled()) &&
                (await page.getByRole('button', { name: '更新索引' }).isDisabled())
              await waitForPreparedWebSources(page, workspaceId)
              await waitForWebIndexJobIdle(page, workspaceId)
            }
          })

          const webList = await page.evaluate(async (selectedWorkspaceId) => {
            return await window.api.webSourceList({
              workspaceId: String(selectedWorkspaceId || '')
            })
          }, workspaceId)
          const uiSummary = await getWebSourceIndexCounts(page)

          return {
            progressVisible,
            buttonsDisabled,
            crawlStepVisible,
            progressText,
            scanProgressVisible,
            scanButtonsDisabled,
            scanSummary,
            scanStatuses,
            uiSummary,
            summary: webList.summary,
            statuses: webList.items.map((item) => item.index_status)
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.scanProgressVisible &&
              result.scanButtonsDisabled &&
              result.scanSummary?.needs_index_count === 2 &&
              result.scanStatuses.every((status) => status === 'needs_index'),
            {
              name: 'web-scan-refreshes-summary-before-prepare',
              message:
                '检查更新时应展示进度、禁用两个索引按钮，并把两条网页资料刷新为可索引状态，对齐 SET-WEB-003-AC1、SET-WEB-003-AC2。',
              data: result
            }
          )

          await runtime.assertThat(
            result.progressVisible && result.buttonsDisabled && result.crawlStepVisible,
            {
              name: 'prepare-web-progress-is-visible',
              message:
                '网页索引执行中应展示抓取/索引进度并禁用两个索引操作按钮，对齐 SET-WEB-004-AC4。',
              data: result
            }
          )

          await runtime.assertThat(
            result.uiSummary.actionableCount === 1 &&
              result.uiSummary.failedHint === '含失败 1 个' &&
              !result.progressText.includes('已处理'),
            {
              name: 'prepare-summary-and-progress-copy-match-file-view',
              message:
                '网页 tab 的可索引数应包含失败网页，并且进度块只保留左侧运行文案，不再单独展示“已处理”区域。',
              data: result
            }
          )

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
              message: '更新索引失败时，应明确区分爬取失败并写回失败数量，对齐 SET-WEB-004-AC3。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_WEB_E2E_TIMEOUT_MS
  )
})
