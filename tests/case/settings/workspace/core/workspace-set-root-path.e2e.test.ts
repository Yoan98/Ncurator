import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
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
        description: '文件 tab 内可以为当前工作空间设置工作目录并立即刷新目录树。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { electronApp, page } = runtime
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
            name: 'create-empty-workspace',
            message: '通过 UI 创建未绑定目录的工作空间。',
            run: async () => {
              await createFixtureWorkspace(page, {
                name: '待绑定目录工作区'
              })
              await navigateToSettingsSection(page, 'workspace')
            }
          })

          await runtime.step({
            name: 'set-root-path',
            message: '通过原生目录选择器绑定真实目录，确认右侧目录与目录树都同步刷新。',
            run: async () => {
              await bindWorkspaceRootThroughSettingsUi(page, targetRootPath, electronApp)
              await page.waitForFunction(
                (input: {
                  detailTestId: string
                  cardPrefix: string
                  rootPathAliases: string[]
                }) => {
                  const normalize = (value: string): string => value.replace(/\s+/g, '')
                  const nodes = [
                    document.querySelector(`[data-testid="${input.detailTestId}"]`),
                    ...Array.from(
                      document.querySelectorAll(`[data-testid^="${input.cardPrefix}-"]`)
                    )
                  ].filter((node): node is HTMLElement => node instanceof HTMLElement)
                  const text = normalize(nodes.map((node) => node.innerText).join('\n'))
                  return input.rootPathAliases.some((alias) => text.includes(normalize(alias)))
                },
                {
                  detailTestId: importSelectors.workspaceDetail,
                  cardPrefix: importSelectors.workspaceCardPrefix,
                  rootPathAliases: [targetRootPath, displayedRootPath]
                }
              )
              const tree = getSettingsLocator(page, importSelectors.workspaceTree)
              const docsNode = tree
                .locator('.ant-tree-treenode')
                .filter({ hasText: 'docs' })
                .first()
              await docsNode.waitFor({ state: 'visible' })
              await docsNode.locator('.ant-tree-switcher').click()
              await tree.getByText('brief.txt').waitFor({ state: 'visible' })
            }
          })

          const detailText =
            (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''
          const cardText =
            (await page
              .locator(`[data-testid^="${importSelectors.workspaceCardPrefix}-"]`)
              .first()
              .textContent()) || ''
          const treeText =
            (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || ''
          const rootPathAliases = [targetRootPath, displayedRootPath].map(normalizeVisibleText)
          const normalizedWorkspaceText = normalizeVisibleText(`${cardText}\n${detailText}`)

          return {
            detailText,
            cardText,
            treeText,
            rootPathVisible: rootPathAliases.some((alias) =>
              normalizedWorkspaceText.includes(alias)
            ),
            treeHasFixtureFile: treeText.includes('brief.txt')
          }
        },
        assert: async (result, runtime) => {
          await runtime.assertThat(result.rootPathVisible && result.treeHasFixtureFile, {
            name: 'set-root-path-refreshes-detail',
            message:
              '点击“设置工作目录”后，应为当前工作空间绑定目录，并立即刷新当前目录树内容，对齐 SET-WORKSPACE-006-AC1、SET-WORKSPACE-008-AC3。',
            data: result
          })
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
