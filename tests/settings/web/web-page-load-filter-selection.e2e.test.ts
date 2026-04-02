import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../harness/e2e/settings'

describe('settings web e2e', () => {
  it('web-page-load-filter-selection', async () => {
    await runE2ECase({
      caseId: 'web-page-load-filter-selection',
      domain: 'settings',
      suite: 'web',
      description: '网页资料页加载后初始化列表与详情，并支持筛选和空结果提示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const searchInput = getSettingsLocator(page, importSelectors.webSourceSearchInput).locator(
          'input'
        )
        let initialCardCount = 0
        let emptyStateVisible = false

        await runtime.step({
          name: 'seed-web-sources',
          message: '预置工作区与两条网页资料，进入工作区设置详情。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-page-load-workspace',
              name: '网页资料工作区'
            })
            await seedWebSources(page, workspace.workspace!.id, [
              'https://example.com/beta',
              'https://docs.example.com/alpha'
            ])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 2,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
            initialCardCount = await getSettingsPrefixLocator(
              page,
              importSelectors.webSourceCardPrefix
            ).count()
          }
        })

        const initialDetailVisible = await page
          .getByRole('button', { name: 'https://docs.example.com/alpha', exact: true })
          .isVisible()

        await runtime.step({
          name: 'filter-by-keyword',
          message: '依次按关键字筛选 alpha、空结果和 beta。',
          run: async () => {
            await searchInput.fill('alpha')
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 1,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
            await page
              .getByRole('button', { name: 'https://docs.example.com/alpha', exact: true })
              .waitFor({ state: 'visible' })

            await searchInput.fill('missing-source')
            await page.getByText('暂无网页资料').waitFor({ state: 'visible' })
            emptyStateVisible = true

            await searchInput.fill('beta')
            await page.waitForFunction(
              (selector) => document.querySelectorAll(selector).length === 1,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
            await page
              .getByRole('button', { name: 'https://example.com/beta', exact: true })
              .waitFor({ state: 'visible' })
          }
        })

        return {
          initialCardCount,
          initialDetailVisible,
          emptyStateVisible,
          betaDetailVisible: await page
            .getByRole('button', { name: 'https://example.com/beta', exact: true })
            .isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.initialCardCount === 2 && result.initialDetailVisible, {
          name: 'web-page-initializes-list-and-detail',
          message: '页面打开后应完成来源列表与详情区初始化，对齐 SET-WEB-001-AC1。',
          data: result
        })

        await runtime.assertThat(result.betaDetailVisible, {
          name: 'keyword-filter-updates-selection',
          message:
            '输入关键字后，列表应按标题、URL 或标准化 URL 过滤，并在结果非空时落到对应详情，对齐 SET-WEB-001-AC2。',
          data: result
        })

        await runtime.assertThat(result.emptyStateVisible, {
          name: 'empty-filter-has-explicit-empty-state',
          message: '筛选结果为空时，页面应明确展示当前筛选为空，而不是表现成加载失败，对齐 SET-WEB-001-AC3。',
          data: result
        })
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
