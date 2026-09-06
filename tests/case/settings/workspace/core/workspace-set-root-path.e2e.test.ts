import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  createWorkspaceThroughSettingsUi,
  getSettingsLocator,
  navigateToSettingsSection
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
        description: '添加文件地址后，树顶层展示路径并可以展开查看子文件。',
        fixtures: [],
        serviceMode: 'real',
        execution: 'exclusive',
        windowMode: 'visible',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          const targetRootPath = await mkdtemp(
            path.join(os.tmpdir(), 'settings-workspace-set-root-')
          )
          runtime.registerResource({
            name: `settings-workspace:${targetRootPath}`,
            phase: 'after-app-close',
            dispose: async () => await rm(targetRootPath, { recursive: true, force: true })
          })
          const displayedRootPath = await realpath(targetRootPath)
          await mkdir(path.join(targetRootPath, 'docs'), { recursive: true })
          await writeFile(path.join(targetRootPath, 'docs', 'brief.txt'), 'hello workspace', 'utf8')

          await runtime.step({
            name: 'add-root-path',
            message: '添加真实目录作为文件地址，确认目录树展示子文件。',
            run: async () => {
              await createWorkspaceThroughSettingsUi(page, targetRootPath)
              await navigateToSettingsSection(page, 'workspace')
              const tree = getSettingsLocator(page, importSelectors.workspaceTree)
              const docsNode = tree.getByText('docs').first()
              await docsNode.waitFor({ state: 'visible' })
              const briefBeforeExpand = await tree.getByText('brief.txt').count()
              await docsNode.click()
              await tree.getByText('brief.txt').waitFor({ state: 'visible' })
              return { briefBeforeExpand }
            }
          })

          const treeText =
            (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || ''
          const rootPathAliases = [targetRootPath, displayedRootPath].map(normalizeVisibleText)
          const normalizedTreeText = normalizeVisibleText(treeText)

          return {
            treeText,
            rootPathVisible: rootPathAliases.some((alias) => normalizedTreeText.includes(alias)),
            treeHasFixtureFile: treeText.includes('brief.txt')
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.rootPathVisible && result.treeHasFixtureFile, {
            name: 'added-root-path-shows-tree',
            message: '添加文件地址后，树顶层应展示该路径，并能展开看到子文件，对齐 SET-WORKSPACE-002。',
            data: result
          })
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
