import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  bindWorkspaceRootThroughSettingsUi,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
} from '../../../../harness/e2e/settings'

describe('settings workspace e2e', () => {
  it(
    'workspace-directory-lazy-load',
    async () => {
      await runE2ECase({
        caseId: 'workspace-directory-lazy-load',
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description: '目录树仅在展开时读取子目录，并在所有层级过滤点开头项。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'exclusive',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const rootPath = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-lazy-'))
          runtime.registerResource({
            name: `settings-workspace:${rootPath}`,
            phase: 'after-app-close',
            dispose: async () => await rm(rootPath, { recursive: true, force: true })
          })
          await mkdir(path.join(rootPath, 'docs'), { recursive: true })
          await mkdir(path.join(rootPath, 'node_modules'), { recursive: true })
          await mkdir(path.join(rootPath, '.private'), { recursive: true })
          await writeFile(path.join(rootPath, 'visible.txt'), 'visible', 'utf8')
          await writeFile(path.join(rootPath, '.hidden.txt'), 'hidden', 'utf8')
          await writeFile(path.join(rootPath, 'docs', 'brief.txt'), 'brief', 'utf8')
          await writeFile(path.join(rootPath, 'docs', '.draft.txt'), 'draft', 'utf8')
          await writeFile(path.join(rootPath, 'node_modules', 'package.txt'), 'module', 'utf8')

          await createFixtureWorkspace(page, { name: '懒加载工作空间' })
          await navigateToSettingsSection(page, 'workspace')
          await bindWorkspaceRootThroughSettingsUi(page, rootPath)

          const tree = getSettingsLocator(page, importSelectors.workspaceTree)
          await tree.getByText('docs').waitFor({ state: 'visible' })
          await tree.getByText('node_modules').waitFor({ state: 'visible' })
          const briefBeforeExpand = await tree.getByText('brief.txt').count()
          const moduleFileBeforeExpand = await tree.getByText('package.txt').count()
          const hiddenRootCount = await tree.getByText('.hidden.txt', { exact: true }).count()
          const hiddenDirectoryCount = await tree.getByText('.private', { exact: true }).count()

          const docsNode = tree.locator('.ant-tree-treenode').filter({ hasText: 'docs' }).first()
          await docsNode.locator('.ant-tree-switcher').click()
          await tree.getByText('brief.txt').waitFor({ state: 'visible' })
          const hiddenChildCount = await tree.getByText('.draft.txt', { exact: true }).count()
          const globalTreeControls = await tree
            .getByLabel(/全部折叠|恢复默认展开/u)
            .count()

          return {
            briefBeforeExpand,
            moduleFileBeforeExpand,
            hiddenRootCount,
            hiddenDirectoryCount,
            hiddenChildCount,
            globalTreeControls
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.briefBeforeExpand === 0 &&
              result.moduleFileBeforeExpand === 0 &&
              result.hiddenRootCount === 0 &&
              result.hiddenDirectoryCount === 0 &&
              result.hiddenChildCount === 0 &&
              result.globalTreeControls === 0,
            {
              name: 'workspace-directory-is-lazy-and-dot-filtered',
              message: '目录树应延迟读取子目录、保留 node_modules 根项、过滤点开头项且不提供全局展开控制。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
