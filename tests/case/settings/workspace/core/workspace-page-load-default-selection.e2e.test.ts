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
    'workspace-page-load-default-selection',
    async () => {
      await runE2ECase({
        caseId: 'workspace-page-load-default-selection',
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description: '工作空间页加载后展示全部文件地址和文件/网页 tab。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const firstRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-first-'))
          const secondRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-second-'))
          runtime.registerResource({
            name: `settings-workspace:${firstRoot}`,
            phase: 'after-app-close',
            dispose: async () => {
              const { rm } = await import('node:fs/promises')
              await rm(firstRoot, { recursive: true, force: true })
              await rm(secondRoot, { recursive: true, force: true })
            }
          })
          await mkdir(path.join(firstRoot, 'docs'), { recursive: true })
          await writeFile(path.join(firstRoot, 'docs', 'a.txt'), 'a', 'utf8')
          await mkdir(path.join(secondRoot, 'docs'), { recursive: true })
          await writeFile(path.join(secondRoot, 'docs', 'b.txt'), 'b', 'utf8')

          await runtime.step({
            name: 'create-workspace-roots',
            message: '添加两个文件地址。',
            run: async () => {
              await createWorkspaceThroughSettingsUi(page, firstRoot)
              await createWorkspaceThroughSettingsUi(page, secondRoot)
            }
          })

          await runtime.step({
            name: 'open-workspace-page',
            message: '重新进入工作空间页并等待文件树完成渲染。',
            run: async () => {
              await navigateToSettingsSection(page, 'model')
              await navigateToSettingsSection(page, 'workspace')
              await getSettingsLocator(page, importSelectors.workspaceList).waitFor({
                state: 'visible'
              })
              await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix)
                .filter({ hasText: path.basename(firstRoot) })
                .first()
                .waitFor({ state: 'visible' })
            }
          })

          return {
            firstRootVisible: await getSettingsPrefixLocator(
              page,
              importSelectors.workspaceCardPrefix
            )
              .filter({ hasText: path.basename(firstRoot) })
              .first()
              .isVisible(),
            secondRootVisible: await getSettingsPrefixLocator(
              page,
              importSelectors.workspaceCardPrefix
            )
              .filter({ hasText: path.basename(secondRoot) })
              .first()
              .isVisible(),
            fileTabVisible: await page.getByRole('tab', { name: /文件/u }).isVisible(),
            webTabVisible: await page.getByRole('tab', { name: /网页/u }).isVisible()
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.firstRootVisible &&
              result.secondRootVisible &&
              result.fileTabVisible &&
              result.webTabVisible,
            {
              name: 'workspace-page-loads-file-roots-and-tabs',
              message:
                '页面打开后应展示全部文件地址，并直接呈现文件 / 网页 tab，对齐 SET-WORKSPACE-001。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_E2E_TIMEOUT_MS
  )
})
