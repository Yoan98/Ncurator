import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('web-refresh-all-summary', async () => {
    await runE2ECase({
      caseId: 'web-refresh-all-summary',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '全部抓取在空列表与非空列表场景下提供明确页面反馈。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const searchInput = getSettingsLocator(page, importSelectors.webSourceSearchInput).locator(
          'input'
        )
        let emptyListWarningShown = false
        let summaryFeedbackShown = false

        await runtime.step({
          name: 'seed-web-sources',
          message: '预置工作区，以及一条可成功刷新和一条会失败的网页资料。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-refresh-all-workspace',
              name: '网页资料工作区'
            })
            await seedWebSources(page, workspace.workspace!.id, [
              'https://example.com/refresh-success',
              'https://refresh-fail.example.com/refresh-fail'
            ])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 2,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
          }
        })

        await runtime.step({
          name: 'refresh-empty-visible-list',
          message: '把当前列表筛到空，再点击全部抓取。',
          run: async () => {
            await searchInput.fill('no-visible-source')
            await page.getByText('暂无网页资料').waitFor({ state: 'visible' })
            await page.getByRole('button', { name: '全部抓取' }).click()
            await page.getByText('暂无可抓取的网页资料').waitFor({ state: 'visible' })
            emptyListWarningShown = true
          }
        })

        await runtime.step({
          name: 'refresh-non-empty-visible-list',
          message: '恢复可见列表并执行全部抓取，观察成功/失败汇总反馈。',
          run: async () => {
            await searchInput.fill('')
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 2,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
            await page.getByRole('button', { name: '全部抓取' }).click()
            await page.getByText('已触发 1 条网页重新抓取，1 条失败').waitFor({ state: 'visible' })
            summaryFeedbackShown = true
          }
        })

        return {
          emptyListWarningShown,
          summaryFeedbackShown,
          remainingCards: await getSettingsPrefixLocator(page, importSelectors.webSourceCardPrefix).count()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.emptyListWarningShown, {
          name: 'empty-visible-list-short-circuits',
          message: '当前列表为空时，不应执行抓取，并提示“暂无可抓取的网页资料”，对齐 SET-WEB-004-AC1。',
          data: result
        })

        await runtime.assertThat(result.summaryFeedbackShown && result.remainingCards === 2, {
          name: 'refresh-all-keeps-list-stable',
          message:
            '全部抓取完成后，页面应给出成功/失败汇总反馈，并保持当前列表可见，对齐 SET-WEB-004-AC2。',
          data: result
        })
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
