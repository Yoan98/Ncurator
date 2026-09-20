import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { queueE2ENativeDialogSelection } from '../../../../harness/e2e/electronApp'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  addWorkspaceDirectoryThroughNativeDialog,
  getSettingsLocator,
  navigateToSettingsSection,
  removeWorkspaceDirectoryThroughSettingsUi,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'

const normalizeVisibleText = (value: string): string => value.replace(/\s+/g, '')

describe('settings workspace e2e', () => {
  it(
    'workspace-set-root-path',
    async () => {
      await runE2ECase({
        caseId: 'workspace-set-root-path',
        domain: 'settings',
        suite: 'workspace',
        groups: ['core'],
        description: '添加目录、子路径拒绝提示、父路径自动替换与扫描后可索引数刷新。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const parentRoot = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-set-root-'))
          const childRoot = path.join(parentRoot, 'docs')
          const grandParent = await mkdtemp(
            path.join(os.tmpdir(), 'settings-workspace-set-root-grand-')
          )
          const nestedUnderGrand = path.join(grandParent, 'inner')
          await mkdir(childRoot, { recursive: true })
          await mkdir(nestedUnderGrand, { recursive: true })
          await writeFile(path.join(childRoot, 'brief.txt'), 'hello workspace', 'utf8')
          runtime.registerResource({
            name: `settings-workspace:${parentRoot}`,
            phase: 'after-app-close',
            dispose: async () => {
              await rm(parentRoot, { recursive: true, force: true })
              await rm(grandParent, { recursive: true, force: true })
            }
          })

          await navigateToSettingsSection(page, 'workspace')
          await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
            state: 'visible'
          })

          await runtime.step({
            name: 'add-root-path',
            message: '通过添加目录按钮加入真实父目录。',
            run: async () => {
              const workspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, parentRoot)
              await waitForFileIndexJobIdle(page, workspaceId)
            }
          })

          const nestedConflict = await runtime.step({
            name: 'reject-nested-child',
            message: '再添加已包含的子目录，应弹出目录已包含并拒绝入库。',
            run: async () => {
              await queueE2ENativeDialogSelection(page, {
                kind: 'directory',
                path: childRoot
              })
              await getSettingsLocator(page, importSelectors.createWorkspaceButton).click()
              const title = page.locator('.ant-modal-confirm-title', { hasText: '目录已包含' })
              await title.waitFor({ state: 'visible', timeout: 10_000 })
              await getSettingsLocator(page, importSelectors.workspaceRootConflictNestedOk).click()
              const list = await page.evaluate(async () => await window.api.workspaceList())
              return {
                dialogVisible: true,
                workspaceCount: list.items.length,
                roots: list.items.map((item) => item.root_path)
              }
            }
          })

          const parentReplace = await runtime.step({
            name: 'parent-replaces-child',
            message: '先加子目录再加父目录，父目录应自动替换子根。',
            run: async () => {
              await removeWorkspaceDirectoryThroughSettingsUi(page, parentRoot)
              const nestedId = await addWorkspaceDirectoryThroughNativeDialog(
                page,
                nestedUnderGrand
              )
              await waitForFileIndexJobIdle(page, nestedId)
              const workspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, grandParent)
              await waitForFileIndexJobIdle(page, workspaceId)
              const list = await page.evaluate(async () => await window.api.workspaceList())
              return {
                workspaceCount: list.items.length,
                roots: list.items.map((item) => item.root_path),
                grandParentReal: await realpath(grandParent)
              }
            }
          })

          await runtime.step({
            name: 'expand-tree',
            message: '确认目录树可展开看到子文件。',
            run: async () => {
              await removeWorkspaceDirectoryThroughSettingsUi(page, grandParent)
              const workspaceId = await addWorkspaceDirectoryThroughNativeDialog(page, parentRoot)
              await waitForFileIndexJobIdle(page, workspaceId)
              await navigateToSettingsSection(page, 'workspace')
              const tree = getSettingsLocator(page, importSelectors.workspaceTree)
              const docsNode = tree.getByText('docs').first()
              await docsNode.waitFor({ state: 'visible' })
              await docsNode.click()
              await tree.getByText('brief.txt').waitFor({ state: 'visible' })
            }
          })

          const treeText =
            (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || ''
          const displayedRootPath = await realpath(parentRoot)
          const rootPathAliases = [parentRoot, displayedRootPath].map(normalizeVisibleText)
          const normalizedTreeText = normalizeVisibleText(treeText)

          return {
            treeText,
            rootPathVisible: rootPathAliases.some((alias) => normalizedTreeText.includes(alias)),
            treeHasFixtureFile: treeText.includes('brief.txt'),
            nestedConflict,
            parentReplace
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.rootPathVisible && result.treeHasFixtureFile, {
            name: 'added-root-path-shows-tree',
            message:
              '添加文件地址后，树顶层应展示该路径，并能展开看到子文件，对齐 SET-WORKSPACE-006-AC1。',
            data: {
              treeText: result.treeText,
              rootPathVisible: result.rootPathVisible,
              treeHasFixtureFile: result.treeHasFixtureFile
            }
          })
          await runtime.assertThat(
            result.nestedConflict.dialogVisible && result.nestedConflict.workspaceCount === 1,
            {
              name: 'nested-child-rejected-with-dialog',
              message: '添加已包含子目录应弹窗拒绝且不入库，对齐 SET-WORKSPACE-006-AC5。',
              data: result.nestedConflict
            }
          )
          await runtime.assertThat(
            result.parentReplace.workspaceCount === 1 &&
              result.parentReplace.roots.some(
                (root) =>
                  normalizeVisibleText(root) ===
                  normalizeVisibleText(result.parentReplace.grandParentReal)
              ),
            {
              name: 'parent-auto-replaces-child',
              message: '添加父目录应自动替换已添加子根，对齐 SET-WORKSPACE-006-AC5。',
              data: result.parentReplace
            }
          )
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
