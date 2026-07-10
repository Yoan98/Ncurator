import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-page-load-default-selection', async () => {
    await runE2ECase({
      caseId: 'workspace-page-load-default-selection',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '工作空间页首屏初始化后，真实数据默认选中第一条工作空间并展示文件/网页 tab。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'create-workspaces-through-ui',
          message: '通过 UI 创建两个工作空间，模拟真实首屏列表数据。',
          run: async () => {
            await createFixtureWorkspace(page, { name: '第一个工作空间' })
            await createFixtureWorkspace(page, { name: '第二个工作空间' })
          }
        })

        await runtime.step({
          name: 'open-workspace-page',
          message: '重新进入工作空间页并等待详情区完成渲染。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceList).waitFor({
              state: 'visible'
            })
            await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
              .filter({ hasText: '第一个工作空间' })
              .first()
              .waitFor({ state: 'visible' })
            await getSettingsLocator(page, importSelectors.workspaceDetail)
              .getByRole('tab', { name: /文件/u })
              .waitFor({ state: 'visible' })
          }
        })

        const firstWorkspaceCard = getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
          .filter({ hasText: '第一个工作空间' })
          .first()
        const firstWorkspaceCardText = (await firstWorkspaceCard.textContent()) || ''
        const firstWorkspaceCardClass = (await firstWorkspaceCard.getAttribute('class')) || ''
        const detailText =
          (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''

        return {
          firstWorkspaceCardText,
          firstWorkspaceCardClass,
          detailText,
          firstWorkspaceSelected: firstWorkspaceCardClass.includes('nc-sidebar-item-active'),
          fileTabVisible: await page.getByRole('tab', { name: /文件/u }).isVisible(),
          webTabVisible: await page.getByRole('tab', { name: /网页/u }).isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.firstWorkspaceSelected && result.fileTabVisible && result.webTabVisible,
          {
            name: 'workspace-page-loads-list-and-detail',
            message:
              '页面打开后应完成工作空间列表和详情区初始化，并直接呈现文件 / 网页 tab，对齐 SET-WORKSPACE-001-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.firstWorkspaceCardText.includes('第一个工作空间') &&
            result.firstWorkspaceCardText.includes('0'),
          {
          name: 'workspace-defaults-to-first-item',
          message:
            '未显式选中时应默认落到第一条工作空间，并能在左侧展示当前工作空间，对齐 SET-WORKSPACE-001-AC2。',
          data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
