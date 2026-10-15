import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
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
        windowMode: 'visible',
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
          await writeFile(path.join(rootPath, 'brief.docx'), '')
          await writeFile(path.join(rootPath, 'grid.xlsx'), '')
          await writeFile(path.join(rootPath, 'slides.pptx'), '')
          await writeFile(path.join(rootPath, 'source.bin'), '')
          await writeFile(path.join(rootPath, 'notes.md'), '# Notes')
          await writeFile(path.join(rootPath, '.hidden.txt'), 'hidden', 'utf8')
          await writeFile(path.join(rootPath, 'docs', 'brief.txt'), 'brief', 'utf8')
          await writeFile(path.join(rootPath, 'docs', '.draft.txt'), 'draft', 'utf8')
          await writeFile(path.join(rootPath, 'node_modules', 'package.txt'), 'module', 'utf8')

          await createFixtureWorkspace(page, { name: '懒加载工作空间', rootPath })
          await navigateToSettingsSection(page, 'workspace')

          const tree = getSettingsLocator(page, importSelectors.workspaceTree)
          await tree.getByText('docs').waitFor({ state: 'visible' })
          await tree.getByText('node_modules').waitFor({ state: 'visible' })
          const briefBeforeExpand = await tree.getByText('brief.txt').count()
          const moduleFileBeforeExpand = await tree.getByText('package.txt').count()
          const hiddenRootCount = await tree.getByText('.hidden.txt', { exact: true }).count()
          const hiddenDirectoryCount = await tree.getByText('.private', { exact: true }).count()

          const docsNode = tree.locator('.ant-tree-treenode').filter({ hasText: 'docs' }).first()
          const rowBefore = await docsNode.evaluate((node) => ({
            height: node.getBoundingClientRect().height,
            background: getComputedStyle(node).backgroundColor
          }))
          await docsNode.hover()
          const rowAfter = await docsNode.evaluate((node) => ({
            height: node.getBoundingClientRect().height,
            background: getComputedStyle(node).backgroundColor
          }))
          const sharedIcons = await tree.evaluate((node) => {
            const coloredLabels = [
              ['docx', 'DOC', 'rgb(59, 130, 246)'],
              ['xlsx', 'XLS', 'rgb(34, 160, 107)'],
              ['ppt', 'PPT', 'rgb(245, 158, 11)']
            ]
            return (
              coloredLabels.every(([kind, label, color]) => {
                const svg = node.querySelector(`svg[data-file-icon="${kind}"]`)
                const shape = svg?.querySelector('path')
                return (
                  svg?.querySelector('text')?.textContent === label &&
                  Math.abs(svg.getBoundingClientRect().width - 18) <= 0.05 &&
                  !!shape &&
                  getComputedStyle(shape).fill === color
                )
              }) &&
              ['directory', 'markdown', 'file'].every((kind) => {
                const svg = node.querySelector(`svg[data-file-icon="${kind}"]`)
                return (
                  !!svg &&
                  Math.abs(svg.getBoundingClientRect().width - (kind === 'directory' ? 16 : 18)) <=
                    0.05 &&
                  svg.getAttribute('fill') === 'currentColor' &&
                  svg.getAttribute('viewBox') ===
                    (kind === 'directory' ? '0 0 16 16' : '0 0 256 256')
                )
              })
            )
          })
          const folderBefore = await docsNode.locator('svg[data-file-icon="directory"]').innerHTML()
          const rowStyleConsistent =
            Math.abs(rowBefore.height - 30) <= 0.05 && rowAfter.background === rowBefore.background
          await docsNode.locator('.ant-tree-switcher').click()
          await tree.getByText('brief.txt').waitFor({ state: 'visible' })
          const folderAfter = await docsNode.locator('svg[data-file-icon="directory"]').innerHTML()
          const folderChangesWhenExpanded = folderBefore !== folderAfter
          await runtime.captureScreenshot({
            name: 'workspace-tree-file-icons',
            message:
              '目录使用库里的打开/关闭图标，Office 文件复用原输入框彩色图标；MD/普通文件使用库内实心图标，统一 18px。'
          })
          const hiddenChildCount = await tree.getByText('.draft.txt', { exact: true }).count()
          const globalTreeControls = await tree.getByLabel(/全部折叠|恢复默认展开/u).count()

          await getSettingsLocator(page, importSelectors.workspaceTreeRefreshButton).click()
          await tree.getByText('brief.txt').waitFor({ state: 'visible' })
          const briefAfterRefresh = await tree.getByText('brief.txt').count()
          const moduleFileAfterRefresh = await tree.getByText('package.txt').count()

          return {
            sharedIcons,
            folderChangesWhenExpanded,
            rowStyleConsistent,
            rowBefore,
            rowAfter,
            briefBeforeExpand,
            moduleFileBeforeExpand,
            hiddenRootCount,
            hiddenDirectoryCount,
            hiddenChildCount,
            globalTreeControls,
            briefAfterRefresh,
            moduleFileAfterRefresh
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(
            result.sharedIcons &&
              result.folderChangesWhenExpanded &&
              result.rowStyleConsistent &&
              result.briefBeforeExpand === 0 &&
              result.moduleFileBeforeExpand === 0 &&
              result.hiddenRootCount === 0 &&
              result.hiddenDirectoryCount === 0 &&
              result.hiddenChildCount === 0 &&
              result.globalTreeControls === 0 &&
              result.briefAfterRefresh > 0 &&
              result.moduleFileAfterRefresh === 0,
            {
              name: 'workspace-directory-is-lazy-and-dot-filtered',
              message:
                '目录树应延迟读取子目录、保留 node_modules 根项、过滤点开头项且不提供全局展开控制；右上刷新后已展开节点保持展开、未展开目录不被自动展开。',
              data: result
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
