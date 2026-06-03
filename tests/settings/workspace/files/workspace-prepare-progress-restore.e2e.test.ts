import { describe, it } from 'vitest'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it(
    'workspace-prepare-progress-restore',
    async () => {
      await runE2ECase({
        caseId: 'workspace-prepare-progress-restore',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '文件索引执行中离开并返回工作空间页后，应恢复持久化进度块和按钮禁用状态。',
        fixtures: [],
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceId = ''
          let restoredProgressVisible = false
          let restoredButtonsDisabled = false
          let restoredActiveJob = false

          await runtime.step({
            name: 'seed-delayed-workspace',
            message: '创建带 prepare 延迟的 fixture 工作空间，并触发文件索引。',
            run: async () => {
              const workspace = await createFixtureWorkspace(page, {
                rootPath: '/tmp/ncurator-e2e-settings-workspace-prepare-delay-restore',
                name: '文件进度恢复工作区'
              })
              workspaceId = workspace.workspace!.id
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
            }
          })

          await runtime.step({
            name: 'restore-progress-after-route-change',
            message: '切到其他设置页再返回工作空间页，确认 active job 进度仍可恢复。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceIndexJobProgress).waitFor({
                state: 'visible'
              })
              const activeJobResponse = await page.evaluate(async (selectedWorkspaceId) => {
                return await window.api.workspaceIndexJobGet({
                  workspaceId: String(selectedWorkspaceId || ''),
                  sourceKind: 'file'
                })
              }, workspaceId)
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
              restoredActiveJob =
                activeJobResponse.success && activeJobResponse.job?.status === 'running'
            }
          })

          await page.waitForFunction(async (selectedWorkspaceId) => {
            const response = await window.api.workspaceTree({
              workspaceId: String(selectedWorkspaceId || ''),
              includeUnsupported: true
            })
            return response.summary.indexed_file_count === 1
          }, workspaceId)

          return {
            restoredProgressVisible,
            restoredButtonsDisabled,
            restoredActiveJob
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.restoredProgressVisible &&
              result.restoredButtonsDisabled &&
              result.restoredActiveJob,
            {
              name: 'file-progress-restores-after-return',
              message:
                '离开并返回文件 tab 后，应通过持久化 running job 恢复进度块并继续禁用两个按钮，对齐 SET-WORKSPACE-004-AC4。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
