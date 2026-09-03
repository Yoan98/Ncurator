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
  it(
    'workspace-add-selection-flow',
    async () => {
      await runE2ECase({
        caseId: 'workspace-add-selection-flow',
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description: '添加工作空间时按名称创建空容器，并在成功后自动切到新工作空间。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let emptyNameBlocked = false
          let createModalVisibleAfterEmptySubmit = false
          let maskClickPreservedInput = false
          let noWorkspaceDetailPromptVisible = false

          await runtime.step({
            name: 'open-empty-workspace-page',
            message: '进入空工作空间页并打开创建工作空间弹窗。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
                state: 'visible'
              })
              await page.getByText('选择一个工作空间').waitFor({ state: 'visible' })
              noWorkspaceDetailPromptVisible = await page.getByText('选择一个工作空间').isVisible()
              await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
              await getSettingsLocator(page, importSelectors.createWorkspaceNameInput).fill(
                '遮罩保留工作空间'
              )
              await page
                .locator('.ant-modal-wrap')
                .last()
                .click({ position: { x: 8, y: 8 } })
              maskClickPreservedInput =
                (await getSettingsLocator(
                  page,
                  importSelectors.createWorkspaceNameInput
                ).isVisible()) &&
                (await getSettingsLocator(
                  page,
                  importSelectors.createWorkspaceNameInput
                ).inputValue()) === '遮罩保留工作空间'
              await getSettingsLocator(page, importSelectors.createWorkspaceNameInput).clear()
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
              await page.getByText('当前目录没有可显示文件').waitFor({ state: 'visible' })
            }
          })

          const detailText =
            (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''

          return {
            emptyNameBlocked,
            createModalStillVisible: createModalVisibleAfterEmptySubmit,
            maskClickPreservedInput,
            noWorkspaceDetailPromptVisible,
            emptyTreeVisible: await page.getByText('当前目录没有可显示文件').isVisible(),
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
          await runtime.assertThat(
            result.noWorkspaceDetailPromptVisible && result.emptyTreeVisible,
            {
              name: 'workspace-empty-states-remain-explicit',
              message:
                '没有工作空间时详情区应显示选择提示，创建未绑定目录的工作空间后文件区应显示明确空态，对齐 SET-WORKSPACE-007-AC1、SET-WORKSPACE-007-AC2。',
              data: result
            }
          )

          await runtime.assertThat(result.emptyNameBlocked && result.createModalStillVisible, {
            name: 'empty-name-is-blocked',
            message: '工作空间名称为空时不允许提交创建，对齐 SET-WORKSPACE-002-AC1。',
            data: result
          })

          await runtime.assertThat(result.maskClickPreservedInput, {
            name: 'workspace-create-dialog-mask-click-keeps-input',
            message:
              '创建工作空间时点击弹窗遮罩不应关闭弹窗或清空名称，对齐 SET-WORKSPACE-002-AC3。',
            data: result
          })

          await runtime.assertThat(
            result.workspaceCardCount === 1 &&
              result.createdWorkspaceVisible &&
              result.showsUnboundRootHint,
            {
              name: 'created-workspace-is-selected-immediately',
              message:
                '创建成功后，新工作空间应立刻进入列表并成为当前选中项，同时作为空容器显示未绑定文件目录与「设置后才能在 Workbench 发送」轻提示，对齐 SET-WORKSPACE-002-AC2、SET-WORKSPACE-006-AC3。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
