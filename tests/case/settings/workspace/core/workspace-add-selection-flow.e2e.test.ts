import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it('workspace-add-selection-flow', async () => {
    await runE2ECase({
      caseId: 'workspace-add-selection-flow',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '添加工作空间时按名称创建空容器，并在成功后自动切到新工作空间。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let emptyNameBlocked = false
        let createModalVisibleAfterEmptySubmit = false

        await runtime.step({
          name: 'open-empty-workspace-page',
          message: '进入空工作空间页并打开创建工作空间弹窗。',
          run: async () => {
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
              state: 'visible'
            })
            await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
          }
        })

        await runtime.step({
          name: 'block-empty-name',
          message: '不输入名称直接提交，确认页面拦截空名称创建。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.createWorkspaceConfirmButton).click()
            emptyNameBlocked = true
            createModalVisibleAfterEmptySubmit = await getSettingsLocator(
              page,
              importSelectors.createWorkspaceNameInput
            ).isVisible()
          }
        })

        await runtime.step({
          name: 'create-workspace-by-name',
          message: '输入工作空间名称并创建，等待左侧列表和右侧详情同步更新。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.createWorkspaceNameInput).fill(
              '新工作空间'
            )
            await getSettingsLocator(page, importSelectors.createWorkspaceConfirmButton).click()
            await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
              .filter({ hasText: '新工作空间' })
              .first()
              .waitFor({ state: 'visible' })
            await getSettingsLocator(page, importSelectors.workspaceDetail)
              .getByRole('tab', { name: /文件/u })
              .waitFor({ state: 'visible' })
          }
        })

        const detailText =
          (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''

        return {
          emptyNameBlocked,
          createModalStillVisible: createModalVisibleAfterEmptySubmit,
          workspaceCardCount: await getSettingsPrefixLocator(
            page,
            importSelectors.workspaceCardPrefix
          ).count(),
          createdWorkspaceVisible: await getSettingsPrefixLocator(
            page,
            importSelectors.workspaceCardPrefix
          )
            .filter({ hasText: '新工作空间' })
            .first()
            .isVisible(),
          showsUnboundRootHint:
            detailText.includes('设置工作目录') ||
            detailText.includes('设置后才能在 Workbench 中发送任务')
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.emptyNameBlocked && result.createModalStillVisible, {
          name: 'empty-name-is-blocked',
          message: '工作空间名称为空时不允许提交创建，对齐 SET-WORKSPACE-002-AC1。',
          data: result
        })

        await runtime.assertThat(
          result.workspaceCardCount === 1 &&
            result.createdWorkspaceVisible &&
            result.showsUnboundRootHint,
          {
            name: 'created-workspace-is-selected-immediately',
            message:
              '创建成功后，新工作空间应立刻进入列表并成为当前选中项，同时作为空容器显示未绑定文件目录，对齐 SET-WORKSPACE-002-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
