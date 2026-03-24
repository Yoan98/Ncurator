import { test } from 'vitest'
import type { WebSourceListResponse } from '../../../../../src/shared/types'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { openWorkspaceSettings } from '../../utils/workspaceUi'

const E2E_WEB_SOURCE_ID = 'e2e-web-source-1'
const E2E_WEB_SOURCE_URL = 'https://example.com/workspace-test'

test('settings-web-source-management', async () => {
  await runE2ECase({
    caseId: 'settings-web-source-management',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'e2e',
    suite: 'settings',
    groups: ['scenario'],
    description:
      'settings should support adding, filtering, refreshing, and deleting web sources from the unified Workspace entry.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      await runtime.step({
        name: 'open-workspace-settings',
        message: '进入 Workspace 设置页',
        run: async () => {
          await openWorkspaceSettings(runtime.page)
        }
      })

      await runtime.step({
        name: 'add-web-source',
        message: '通过设置页添加一条网页资料',
        run: async () => {
          await runtime.page.getByTestId(importSelectors.webSourceOpenModalButton).click()
          await runtime.page.getByTestId(importSelectors.webSourceUrlInput).fill(E2E_WEB_SOURCE_URL)
          await runtime.page.getByTestId(importSelectors.webSourceConfirmButton).click()
          await runtime.page.waitForSelector(
            `[data-testid="${importSelectors.webSourceCardPrefix}-${E2E_WEB_SOURCE_ID}"]`
          )
        }
      })

      const initialWebSources = await runtime.page.evaluate(async (): Promise<WebSourceListResponse> => {
        return window.api.webSourceList()
      })

      await runtime.step({
        name: 'filter-web-source',
        message: '使用搜索输入过滤网页资料列表',
        run: async () => {
          await runtime.page.getByPlaceholder('按标题或 URL 过滤网页资料').fill('workspace-test')
          await runtime.page.waitForFunction(
            ({ cardTestId }) => Boolean(document.querySelector(`[data-testid="${cardTestId}"]`)),
            {
              cardTestId: `${importSelectors.webSourceCardPrefix}-${E2E_WEB_SOURCE_ID}`
            }
          )
        }
      })

      await runtime.step({
        name: 'refresh-web-source',
        message: '从列表中刷新网页资料',
        run: async () => {
          const beforeRefreshUpdatedAt = initialWebSources.items[0]?.updated_at || 0
          await runtime.page
            .getByTestId(`${importSelectors.webSourceRefreshButtonPrefix}-${E2E_WEB_SOURCE_ID}`)
            .click()
          await runtime.page.waitForFunction(
            async ({ updatedAt }) => {
              const response = await window.api.webSourceList()
              const item = response.items.find((entry) => entry.id === 'e2e-web-source-1')
              return Boolean(item && item.updated_at > updatedAt)
            },
            {
              updatedAt: beforeRefreshUpdatedAt
            }
          )
        }
      })

      const refreshedWebSources = await runtime.page.evaluate(async (): Promise<WebSourceListResponse> => {
        return window.api.webSourceList()
      })

      await runtime.step({
        name: 'delete-web-source',
        message: '从列表中删除网页资料',
        run: async () => {
          await runtime.page
            .getByTestId(`${importSelectors.webSourceDeleteButtonPrefix}-${E2E_WEB_SOURCE_ID}`)
            .click()
          await runtime.page.getByTestId(importSelectors.webSourceDeleteConfirmButton).click()
          await runtime.page.waitForFunction(
            ({ cardTestId }) => !document.querySelector(`[data-testid="${cardTestId}"]`),
            {
              cardTestId: `${importSelectors.webSourceCardPrefix}-${E2E_WEB_SOURCE_ID}`
            }
          )
        }
      })

      const finalWebSources = await runtime.page.evaluate(async (): Promise<WebSourceListResponse> => {
        return window.api.webSourceList()
      })
      const webSourceSectionText = await runtime.page.getByTestId(importSelectors.webSourceSection).innerText()

      await runtime.captureScreenshot({
        name: 'settings-web-source-management',
        message: '网页资料添加、刷新和删除后的设置页截图'
      })

      return {
        initialWebSources,
        refreshedWebSources,
        finalWebSources,
        webSourceSectionText
      }
    },
    assert: async (result, runtime) => {
      await runtime.assertThat(
        result.initialWebSources.items.some((item) => item.url === E2E_WEB_SOURCE_URL),
        {
          name: 'settings-web-source-added-to-list',
          message: 'new web sources added from settings should appear in the unified list immediately',
          data: result
        }
      )

      await runtime.assertThat(
        (result.refreshedWebSources.items[0]?.updated_at || 0) >=
          (result.initialWebSources.items[0]?.updated_at || 0),
        {
          name: 'settings-web-source-refresh-updates-state',
          message: 'refreshing a web source from settings should update its persisted timestamps or state',
          data: result
        }
      )

      await runtime.assertThat(
        result.finalWebSources.items.length === 0 &&
          result.webSourceSectionText.includes('暂无网页资料'),
        {
          name: 'settings-web-source-delete-clears-list',
          message: 'deleting the only web source should remove it from the list and restore the empty state',
          data: result
        }
      )
    }
  })
})
