import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createWorkspaceThroughSettingsUi,
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
        description: '设置页可添加文件地址，树顶层展示该地址，空态不再要求具名工作空间。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const rootPath = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-add-'))
          runtime.registerResource({
            name: `settings-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => {
              const { rm } = await import('node:fs/promises')
              await rm(rootPath, { recursive: true, force: true })
            }
          })
          await mkdir(path.join(rootPath, 'docs'), { recursive: true })
          await writeFile(path.join(rootPath, 'docs', 'note.txt'), 'hello', 'utf8')

          await runtime.step({
            name: 'open-empty-workspace-page',
            message: '进入空工作空间页，确认还没有文件地址。',
            run: async () => {
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
                state: 'visible'
              })
            }
          })

          const displayName = path.basename(rootPath)
          await runtime.step({
            name: 'add-root-path',
            message: '添加本地目录作为文件地址，等待树顶层出现该路径。',
            run: async () => {
              await createWorkspaceThroughSettingsUi(page, rootPath)
              await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
                .filter({ hasText: displayName })
                .first()
                .waitFor({ state: 'visible' })
            }
          })

          const duplicate = await page.evaluate(
            async (workspaceRootPath) => await window.api.workspaceCreate({ rootPath: workspaceRootPath }),
            rootPath
          )

          return {
            emptyStateHidden: !(await getSettingsLocator(page, importSelectors.workspaceEmptyState)
              .isVisible()
              .catch(() => false)),
            workspaceCardCount: await getSettingsPrefixLocator(
              page,
              importSelectors.workspaceCardPrefix
            ).count(),
            createdRootVisible: await getSettingsPrefixLocator(
              page,
              importSelectors.workspaceCardPrefix
            )
              .filter({ hasText: displayName })
              .first()
              .isVisible(),
            duplicateRejected: duplicate.success === false,
            fileTabVisible: await page.getByRole('tab', { name: /文件/u }).isVisible(),
            webTabVisible: await page.getByRole('tab', { name: /网页/u }).isVisible()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.emptyStateHidden &&
              result.workspaceCardCount === 1 &&
              result.createdRootVisible &&
              result.duplicateRejected &&
              result.fileTabVisible &&
              result.webTabVisible,
            {
              name: 'workspace-root-is-added-as-tree-top-level',
              message:
                '添加文件地址后树顶层应展示该路径，重复添加被拒绝，文件/网页 tab 仍可用，对齐 SET-WORKSPACE-001 / SET-WORKSPACE-002。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
