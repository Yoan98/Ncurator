import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  navigateToSettingsSection,
  seedWebSources,
  startLocalSettingsHttpServer,
  waitForWebIndexJobIdle
} from '../../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it(
    'web-prepare-cancel',
    async () => {
      await runE2ECase({
        caseId: 'web-prepare-cancel',
        domain: 'settings',
        suite: 'workspace',
        groups: ['web'],
        description: '网页更新索引进行中可取消，确认框展示进度，停止后未完成网页不落成已索引。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const httpServer = await startLocalSettingsHttpServer({
            '/web-cancel-a': {
              body: '<html><head><title>Web Cancel A</title></head><body>Delayed local web fixture A.</body></html>',
              delayMs: 8_000
            },
            '/web-cancel-b': {
              body: '<html><head><title>Web Cancel B</title></head><body>Delayed local web fixture B.</body></html>',
              delayMs: 8_000
            }
          })
          runtime.registerResource({
            name: 'settings-http-server',
            phase: 'before-app-close',
            dispose: httpServer.close
          })

          const workspace = await createFixtureWorkspace(page, {
            rootPath: '/tmp/ncurator-e2e-settings-web-prepare-cancel',
            name: '网页取消索引工作区'
          })
          await seedWebSources(page, workspace.workspace!.id, [
            httpServer.url('/web-cancel-a'),
            httpServer.url('/web-cancel-b')
          ])
          await navigateToSettingsSection(page, 'workspace')
          await page.getByRole('tab', { name: /网页/u }).click()
          await page.getByRole('button', { name: '更新索引', exact: true }).click()
          await page.getByTestId(importSelectors.webSourceIndexJobProgress).waitFor({
            state: 'visible'
          })

          const cancelButton = page.getByRole('button', { name: '取消', exact: true })
          await cancelButton.waitFor({ state: 'visible' })
          const cancelDisabled = await cancelButton.isDisabled()
          await cancelButton.click()
          const dialog = page.getByRole('dialog')
          await dialog.waitFor({ state: 'visible' })
          const dialogText = (await dialog.innerText()) || ''
          await page.getByTestId(importSelectors.webSourceIndexCancelContinueButton).click()
          await dialog.waitFor({ state: 'hidden' })
          const continuedProgressVisible = await page
            .getByTestId(importSelectors.webSourceIndexJobProgress)
            .isVisible()

          await cancelButton.click()
          await dialog.waitFor({ state: 'visible' })
          await page.getByTestId(importSelectors.webSourceIndexCancelConfirmButton).click()
          await waitForWebIndexJobIdle(page, '', SETTINGS_WEB_E2E_TIMEOUT_MS)
          const idleButtonVisible = await page
            .getByRole('button', { name: '更新索引', exact: true })
            .isVisible()
          const webList = await page.evaluate(async () => {
            return await window.api.webSourceList({})
          })

          return {
            cancelDisabled,
            dialogText,
            continuedProgressVisible,
            idleButtonVisible,
            statuses: webList.items.map((item) => item.index_status),
            failedCount: webList.summary.failed_count
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.cancelDisabled === false, {
            name: 'web-prepare-button-becomes-cancel',
            message: '网页更新索引执行中按钮应为「取消」且可点，对齐 SET-WEB-004-AC10。',
            data: result
          })
          await runtime.assertThat(
            /已完成 \d+ 个网页/.test(result.dialogText) &&
              /剩余 \d+ 个网页将停止/.test(result.dialogText) &&
              result.continuedProgressVisible,
            {
              name: 'web-cancel-dialog-shows-counts-and-continue-keeps-running',
              message:
                '取消确认框应展示已完成 N 与剩余 M 个网页；继续更新后任务继续跑，对齐 SET-WEB-004-AC11。',
              data: result
            }
          )
          await runtime.assertThat(
            result.idleButtonVisible &&
              result.statuses.every((status) => status !== 'crawling' && status !== 'indexing') &&
              result.statuses.some((status) => status !== 'indexed') &&
              result.failedCount === 0,
            {
              name: 'web-cancel-reverts-unfinished',
              message:
                '停止后未完成网页不落成已索引，也不因取消标成新失败，按钮回到「更新索引」，对齐 SET-WEB-004-AC12、SET-WEB-004-AC13。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_WEB_E2E_TIMEOUT_MS
  )
})
