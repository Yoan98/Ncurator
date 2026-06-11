import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type { WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../../../harness/e2e/settings'

const waitForWorkspaceTree = async (
  page: Page,
  workspaceId: string,
  predicate: (response: WorkspaceTreeListResponse) => boolean,
  timeoutMs = 5000
): Promise<WorkspaceTreeListResponse> => {
  const deadline = Date.now() + timeoutMs
  let lastResponse = await page.evaluate(async (selectedWorkspaceId) => {
    return await window.api.workspaceTree({
      workspaceId: String(selectedWorkspaceId || ''),
      includeUnsupported: true
    })
  }, workspaceId)

  while (!predicate(lastResponse)) {
    if (Date.now() >= deadline) return lastResponse
    await page.waitForTimeout(200)
    lastResponse = await page.evaluate(async (selectedWorkspaceId) => {
      return await window.api.workspaceTree({
        workspaceId: String(selectedWorkspaceId || ''),
        includeUnsupported: true
      })
    }, workspaceId)
  }

  return lastResponse
}

describe('settings workspace e2e', () => {
  it('workspace-set-root-path', async () => {
    await runE2ECase({
      caseId: 'workspace-set-root-path',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '文件 tab 内可以为当前工作空间设置工作文件地址并立即刷新目录树。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const targetRootPath = '/tmp/settings-workspace-set-root-path'
        let workspaceId = ''

        await runtime.step({
          name: 'seed-empty-workspace',
          message: '先创建未绑定目录的工作空间，并为目录选择器注入固定返回值。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              name: '待绑定目录工作区'
            })
            workspaceId = workspace.workspace!.id
            await setSettingsE2EApiOverrides(page, {
              pickDirectoryResponse: {
                canceled: false,
                path: targetRootPath
              }
            })
            await navigateToSettingsSection(page, 'workspace')
          }
        })

        await runtime.step({
          name: 'set-root-path',
          message: '点击设置工作文件地址，确认右侧目录与目录树都同步刷新。',
          run: async () => {
            await page.getByRole('button', { name: '设置工作文件地址' }).click()
            await getSettingsLocator(page, importSelectors.workspaceDetail)
              .getByText(targetRootPath, { exact: true })
              .waitFor({ state: 'visible' })
          }
        })

        const detailText =
          (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''
        const treeResponse = await waitForWorkspaceTree(
          page,
          workspaceId,
          (response) => response.items.some((item) => item.name === 'brief.txt')
        )

        return {
          detailText,
          rootPathVisible: detailText.includes(targetRootPath),
          treeHasFixtureFile: treeResponse.items.some((item) => item.name === 'brief.txt')
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(result.rootPathVisible && result.treeHasFixtureFile, {
          name: 'set-root-path-refreshes-detail',
          message:
            '点击“设置工作文件地址”后，应为当前工作空间绑定目录，并立即刷新当前目录树内容，对齐 SET-WORKSPACE-006-AC1、SET-WORKSPACE-008-AC3。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
