import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import { copyScenarioWorkspaceFixture } from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-progress-restore',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-progress-restore',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '文件索引执行中离开并返回工作空间页后，应恢复持久化进度块和取消按钮状态。',
        fixtures: ['tests/fixtures/workspace-scenarios/workspace-prepare-progress-restore'],
        knowledge: 'cached',
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''

          workspaceRoot = await copyScenarioWorkspaceFixture('workspace-prepare-progress-restore')
          const workspace = await createRealWorkspaceWithRoot(page, {
            name: '文件进度恢复工作区',
            rootPath: workspaceRoot
          })
          const workspaceId = workspace.workspace!.id

          await runtime.step({
            name: 'start-real-prepare',
            message: '通过 UI 对真实多文件工作区启动索引，并等待进度块出现。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
            }
          })

          let restoredProgressVisible = false
          let restoredButtonsDisabled = false
          let restoredPrepareButtonName = ''

          await runtime.step({
            name: 'restore-progress-after-route-change',
            message: '切到其他设置页再返回工作空间页，确认 running job 进度仍可恢复。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
              restoredProgressVisible = await getSettingsLocator(
                page,
                importSelectors.workspaceIndexJobProgress
              ).isVisible()
              restoredButtonsDisabled =
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickScanButton
                ).isDisabled()) &&
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickPrepareButton
                ).isDisabled())
              restoredPrepareButtonName = (
                (await getSettingsLocator(
                  page,
                  importSelectors.workspaceQuickPrepareButton
                ).innerText()) || ''
              ).trim()
            }
          })

          const idle = await waitForFileIndexJobIdle(
            page,
            workspaceId,
            SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
          )

          return {
            restoredProgressVisible,
            restoredButtonsDisabled,
            restoredPrepareButtonName,
            failedFileCount: idle.tree.summary.failed_file_count
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.restoredProgressVisible &&
              !result.restoredButtonsDisabled &&
              result.restoredPrepareButtonName.includes('取消') &&
              result.failedFileCount > 0,
            {
              name: 'file-progress-restores-after-return',
              message:
                '离开并返回文件 tab 后，应通过持久化 running job 恢复进度块，「检查更新」可用，「更新索引」文案为「取消」且可点，对齐 SET-WORKSPACE-004-AC4、SET-WORKSPACE-004-AC12。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_LONG_E2E_TIMEOUT_MS
  )
})
