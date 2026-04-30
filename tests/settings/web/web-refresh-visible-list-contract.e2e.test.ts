import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../harness/e2e/settings'

describe('settings web e2e', () => {
  it('web-refresh-visible-list-contract', async () => {
    await runE2ECase({
      caseId: 'web-refresh-visible-list-contract',
      domain: 'settings',
      suite: 'web',
      description: '全部抓取只对当前可见列表里的网页资料触发刷新请求。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const searchInput = getSettingsLocator(page, importSelectors.webSourceSearchInput).locator(
          'input'
        )

        await runtime.step({
          name: 'seed-web-sources',
          message: '预置两个网页资料，并进入工作区详情。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-web-refresh-visible-list-contract',
              name: '可见列表工作区'
            })
            await seedWebSources(page, workspace.workspace!.id, [
              'https://example.com/refresh-target-a',
              'https://example.com/refresh-target-b'
            ])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
          }
        })

        await runtime.step({
          name: 'refresh-only-visible-source',
          message: '筛到只剩一个可见网页资料后执行全部抓取。',
          run: async () => {
            await searchInput.fill('target-a')
            await page.getByRole('button', { name: '全部抓取' }).click()
          }
        })

        const signals = await runtime.collectSignals()

        return {
          refreshCalls: signals.ipcInvokeEntries.filter((entry) => entry.name === 'webSourceRefresh'),
          visibleCardCount: await page.evaluate(
            (selector: string) =>
              Array.from(document.querySelectorAll(selector)).filter(
                (element) => element instanceof HTMLElement && element.offsetParent !== null
              ).length,
            `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
          )
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.visibleCardCount === 1 &&
            result.refreshCalls.length === 1 &&
            String(result.refreshCalls[0]?.payload || '').includes('target-a'),
          {
            name: 'refresh-all-uses-visible-list-only',
            message:
              '当前列表非空时，只有当前可见列表中的网页资料进入刷新请求，不包含被筛掉的项目，对齐 SET-WEB-004 执行范围约束。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
