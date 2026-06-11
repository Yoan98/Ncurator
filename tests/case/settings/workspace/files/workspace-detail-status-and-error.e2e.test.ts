import type { Page } from 'playwright'
import { describe, it } from 'vitest'
import type { WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  createFixtureWorkspace,
  getSettingsLocator,
  getWorkspaceIndexCounts,
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
  it('workspace-detail-status-and-error', async () => {
    await runE2ECase({
      caseId: 'workspace-detail-status-and-error',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '文件 tab 持续展示需索引/失败摘要，并在索引失败后保留文件级错误状态。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        let workspaceId = ''

        await runtime.step({
          name: 'seed-failing-workspace',
          message: '创建一条 prepare 会失败的 fixture 工作空间，并进入工作空间页。',
          run: async () => {
            const workspace = await createFixtureWorkspace(page, {
              rootPath: '/tmp/ncurator-e2e-settings-workspace-prepare-fail',
              name: '失败工作区'
            })
            workspaceId = workspace.workspace!.id
            await navigateToSettingsSection(page, 'workspace')
          }
        })

        await runtime.step({
          name: 'trigger-prepare-error',
          message: '点击更新索引，让 fixture 返回失败状态和文件级错误。',
          run: async () => {
            await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
          }
        })
        const treeResponse = await waitForWorkspaceTree(
          page,
          workspaceId,
          (response) => response.summary.failed_file_count === 1
        )
        const counts = await getWorkspaceIndexCounts(page)

        return {
          summary: treeResponse.summary,
          counts,
          treeText: (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || '',
          failedItems: treeResponse.items
            .filter((item) => item.kind === 'file' && item.index_status === 'failed')
            .map((item) => ({
              name: item.name,
              lastError: item.last_error || ''
            }))
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.summary.needs_index_count === 0 &&
            result.summary.failed_file_count === 1 &&
            result.counts.actionableCount === 1 &&
            result.counts.failedHint.includes('含失败 1 个'),
          {
            name: 'workspace-summary-shows-actionable-count-with-failed-hint',
            message:
              '文件 tab 应用可索引数包含失败数量，并用辅助文案展示失败数量，对齐 SET-WORKSPACE-005-AC2。',
            data: result
          }
        )

        await runtime.assertThat(
          result.failedItems.length === 1 &&
            result.failedItems[0]?.name === 'brief.txt' &&
            result.failedItems[0]?.lastError.includes('E2E fixture prepare failed'),
          {
            name: 'file-level-failure-state-is-preserved',
            message:
              '文件索引失败后，应在文件级状态里保留失败标记和错误信息，对齐 SET-WORKSPACE-008-AC2。',
            data: result
          }
        )

        await runtime.assertThat(!result.treeText.includes('/'), {
          name: 'workspace-tree-removes-file-subtitle-path',
          message:
            '目录树文件项不应再展示文件名下方的路径辅助字项，对齐 SET-WORKSPACE-008-AC2。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
