import { describe, it } from 'vitest'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-add-selection-flow', async () => {
    await runE2ECase({
      caseId: 'workspace-add-selection-flow',
      domain: 'settings',
      suite: 'workspace',
      description: '添加工作空间时，取消目录选择无副作用，成功选择后立即创建并切到新项。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const workspaceDetail = getSettingsLocator(page, importSelectors.workspaceDetail)

        await runtime.step({
          name: 'open-empty-workspace-page',
          message: '进入空工作空间页，并把目录选择器先设为取消返回。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              pickDirectoryResponse: {
                canceled: true
              }
            })
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
              state: 'visible'
            })
          }
        })

        await runtime.step({
          name: 'cancel-directory-selection',
          message: '点击添加工作空间并确认取消路径不会创建记录。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
          }
        })

        const afterCancelCardCount = await getSettingsPrefixLocator(
          page,
          importSelectors.workspaceCardPrefix
        ).count()
        const createFailureVisible = await page.getByText('创建工作空间失败').isVisible().catch(() => false)

        await runtime.step({
          name: 'select-directory-successfully',
          message: '把目录选择器设为成功返回，再次添加工作空间并等待新项自动选中。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              pickDirectoryResponse: {
                canceled: false,
                path: '/tmp/ncurator-e2e-settings-created'
              }
            })
            await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
            await getSettingsLocator(
              page,
              `${importSelectors.workspaceCardPrefix}-e2e-import-workspace-1`
            ).waitFor({ state: 'visible' })
            await workspaceDetail
              .getByText('/tmp/ncurator-e2e-settings-created', { exact: true })
              .waitFor({ state: 'visible' })
          }
        })

        return {
          afterCancelCardCount,
          createFailureVisible,
          finalCardCount: await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix).count(),
          createdWorkspaceVisible: await workspaceDetail
            .getByRole('heading', { name: 'ncurator-e2e-settings-created' })
            .isVisible(),
          createdRootPathVisible: await workspaceDetail
            .getByText('/tmp/ncurator-e2e-settings-created', { exact: true })
            .isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.afterCancelCardCount === 0 && !result.createFailureVisible, {
          name: 'cancel-pick-directory-has-no-side-effects',
          message:
            '用户取消目录选择时，不应创建工作空间，也不应弹出失败提示，对齐 SET-WORKSPACE-002-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.finalCardCount === 1 &&
            result.createdWorkspaceVisible &&
            result.createdRootPathVisible,
          {
            name: 'successful-create-selects-new-workspace',
            message:
              '创建成功后，新工作空间应立刻出现在列表中并成为当前选中项，对齐 SET-WORKSPACE-002-AC2。',
            data: result
          }
        )
      }
    })
  })
})
