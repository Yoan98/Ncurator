import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
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
  it(
    'workspace-remove-from-list',
    async () => {
      await runE2ECase({
        caseId: 'workspace-remove-from-list',
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description: '移除工作空间后，列表和详情区不再继续展示已删除项。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const rootPath = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-remove-'))
          runtime.registerResource({
            name: `settings-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => await rm(rootPath, { recursive: true, force: true })
          })

          await runtime.step({
            name: 'seed-workspace',
            message: '创建一条待移除工作空间并进入工作空间页。',
            run: async () => {
              const created = await createFixtureWorkspace(page, {
                name: '待移除工作区',
                rootPath
              })
              if (!created.success || !created.workspace) {
                throw new Error(created.error || 'failed to create workspace for removal')
              }
              await navigateToSettingsSection(page, 'workspace')
            }
          })

          await runtime.step({
            name: 'remove-workspace',
            message: '在详情区点击移除并确认删除，等待左侧空态出现。',
            run: async () => {
              await getSettingsLocator(page, importSelectors.workspaceRemoveButton).click()
              await getSettingsLocator(page, importSelectors.workspaceDeleteConfirmButton).click()
              await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
                state: 'visible'
              })
            }
          })

          return {
            listEmptyVisible: await getSettingsLocator(
              page,
              importSelectors.workspaceEmptyState
            ).isVisible(),
            emptyDescriptionVisible: await page.getByText('还没有文件地址').isVisible(),
            remainingCards: await getSettingsPrefixLocator(
              page,
              importSelectors.workspaceCardPrefix
            ).count()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.listEmptyVisible &&
              result.emptyDescriptionVisible &&
              result.remainingCards === 0,
            {
              name: 'removed-workspace-disappears-from-list',
              message: '移除成功后，该文件地址应从目录树中消失，对齐 SET-WORKSPACE-006-AC2。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
