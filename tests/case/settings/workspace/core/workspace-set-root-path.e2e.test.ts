import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type { WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  bindWorkspaceRootThroughSettingsUi,
  createFixtureWorkspace,
  getSettingsLocator,
  navigateToSettingsSection
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
        const targetRootPath = await mkdtemp(path.join(os.tmpdir(), 'settings-workspace-set-root-'))
        await mkdir(path.join(targetRootPath, 'docs'), { recursive: true })
        await writeFile(path.join(targetRootPath, 'docs', 'brief.txt'), 'hello workspace', 'utf8')
        let workspaceId = ''

        try {
          await runtime.step({
            name: 'create-empty-workspace',
            message: '通过 UI 创建未绑定目录的工作空间。',
            run: async () => {
              const workspace = await createFixtureWorkspace(page, {
                name: '待绑定目录工作区'
              })
              workspaceId = workspace.workspace!.id
              await navigateToSettingsSection(page, 'workspace')
            }
          })

          await runtime.step({
            name: 'set-root-path',
            message: '通过原生目录选择器绑定真实目录，确认右侧目录与目录树都同步刷新。',
            run: async () => {
              await bindWorkspaceRootThroughSettingsUi(page, targetRootPath)
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
        } finally {
          await rm(targetRootPath, { recursive: true, force: true })
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
  }, SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS)
})
