import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('workspace-detail-contains-web-management', async () => {
    await runE2ECase({
      caseId: 'workspace-detail-contains-web-management',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '网页资料管理区域直接承载在当前工作空间详情区内，而不是跳转独立页面。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const urlTextarea = page.getByPlaceholder('每行一个 URL')

        await runtime.step({
          name: 'seed-workspace-and-web-sources',
          message: '创建工作区与网页资料，进入工作空间详情。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/settings-workspace-detail-contains-web-management',
              name: '网页资料内嵌工作区'
            })
            await seedWebSources(page, workspace.workspace!.id, [
              'https://example.com/embedded-web-a',
              'https://example.com/embedded-web-b'
            ])
            await navigateToSettingsSection(page, 'workspace')
            await workspaceCardLocator(page, workspace.workspace!.id).click()
            await getSettingsLocator(page, importSelectors.workspaceDetail).waitFor({ state: 'visible' })
            await getSettingsLocator(page, importSelectors.webSourceSection).waitFor({ state: 'visible' })
            await getSettingsLocator(page, importSelectors.webSourceList).waitFor({ state: 'visible' })
          }
        })

        await runtime.step({
          name: 'exercise-web-management-inside-detail',
          message: '在当前详情区内使用筛选和添加入口，确认没有跳转独立页面。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.webSourceSearchInput)
              .locator('input')
              .fill('embedded-web-a')
            await page.waitForFunction(
              (selector) =>
                Array.from(document.querySelectorAll(selector)).filter(
                  (element) => element instanceof HTMLElement && element.offsetParent !== null
                ).length === 1,
              `[data-testid^="${importSelectors.webSourceCardPrefix}-"]`
            )
            await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).click()
            await urlTextarea.waitFor({ state: 'visible' })
          }
        })

        return {
          workspaceDetailVisible: await getSettingsLocator(page, importSelectors.workspaceDetail).isVisible(),
          webSectionVisible: await getSettingsLocator(page, importSelectors.webSourceSection).isVisible(),
          webListVisible: await getSettingsLocator(page, importSelectors.webSourceList).isVisible(),
          webSearchVisible: await getSettingsLocator(page, importSelectors.webSourceSearchInput).isVisible(),
          webAddVisible: await getSettingsLocator(page, importSelectors.webSourceOpenModalButton).isVisible(),
          webModalVisible: await urlTextarea.isVisible(),
          currentHash: await page.evaluate(() => window.location.hash)
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.workspaceDetailVisible &&
            result.webSectionVisible &&
            result.webListVisible &&
            result.webSearchVisible &&
            result.webAddVisible,
          {
            name: 'workspace-detail-directly-renders-web-management',
            message:
              '选中工作区后，网页资料列表、筛选和添加入口应直接出现在当前工作空间详情区内，对齐 SET-WORKSPACE-005-AC3。',
            data: result
          }
        )

        await runtime.assertThat(
          result.webModalVisible && result.currentHash === '#/settings/workspace',
          {
            name: 'workspace-detail-keeps-web-actions-in-place',
            message:
              '网页资料管理动作应在当前工作空间详情区内完成，而不是跳转到独立页面，对齐 SET-WORKSPACE-005-AC3。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
