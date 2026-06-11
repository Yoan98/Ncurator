import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_WEB_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  seedWebSources,
  workspaceCardLocator
} from '../../../../harness/e2e/settings'

describe('settings workspace web e2e', () => {
  it('workspace-detail-contains-web-management', async () => {
    await runE2ECase({
      caseId: 'workspace-detail-contains-web-management',
      domain: 'settings',
      suite: 'workspace',
      groups: ['web'],
      description: '网页资料管理直接承载在当前工作空间详情区内，并与文件 tab 平级切换。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'seed-workspace-and-web-sources',
          message: '创建工作区与网页资料，进入工作空间详情并切到网页 tab。',
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
            await page.getByRole('tab', { name: '网页 2' }).click()
            await getSettingsLocator(page, importSelectors.webSourceSection).waitFor({
              state: 'visible'
            })
            await getSettingsLocator(page, importSelectors.webSourceList).waitFor({
              state: 'visible'
            })
          }
        })

        return {
          detailVisible: await getSettingsLocator(page, importSelectors.workspaceDetail).isVisible(),
          webSectionVisible: await getSettingsLocator(page, importSelectors.webSourceSection).isVisible(),
          webListVisible: await getSettingsLocator(page, importSelectors.webSourceList).isVisible(),
          addButtonVisible: await getSettingsLocator(
            page,
            importSelectors.webSourceOpenModalButton
          ).isVisible(),
          currentHash: await page.evaluate(() => window.location.hash)
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.detailVisible &&
            result.webSectionVisible &&
            result.webListVisible &&
            result.addButtonVisible,
          {
            name: 'workspace-detail-renders-web-management',
            message:
              '选中工作区后，网页资料管理应直接出现在当前工作空间详情区内，并包含列表与添加入口，对齐 SET-WORKSPACE-005-AC3、SET-WEB-001-AC3。',
            data: result
          }
        )

        await runtime.assertThat(result.currentHash === '#/settings/workspace', {
          name: 'web-management-stays-inside-workspace-route',
          message:
            '网页资料管理应在工作空间详情内完成，而不是跳转到独立页面，对齐 SET-WORKSPACE-005-AC3。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_WEB_E2E_TIMEOUT_MS)
})
