import { describe, it } from 'vitest'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS,
  createRealWorkspaceWithRoot,
  getSettingsLocator,
  getWorkspaceIndexCounts,
  navigateToSettingsSection,
  waitForFileIndexJobIdle
} from '../../../../harness/e2e/settings'
import {
  cleanupRealWorkspace,
  createWorkspaceWithFiles,
  toSupportedFileStatuses
} from './realWorkspaceHelpers'

describe('settings workspace e2e', () => {
  it(
    'workspace-detail-status-and-error',
    async () => {
      await runE2ECase({
        caseId: 'workspace-detail-status-and-error',
        domain: 'settings',
        suite: 'workspace',
        groups: ['files'],
        description: '文件 tab 持续展示需索引/失败摘要，并在索引失败后保留文件级错误状态。',
        fixtures: [],
        serviceMode: 'real',
        runMode: 'single',
        execute: async (runtime) => {
          const { page } = runtime
          let workspaceRoot = ''

          try {
            workspaceRoot = await createWorkspaceWithFiles('workspace-detail-status-and-error', [
              {
                relativePath: 'docs/broken.docx',
                content: 'not a valid docx archive'
              }
            ])
            const workspace = await createRealWorkspaceWithRoot(page, {
              name: '失败工作区',
              rootPath: workspaceRoot
            })
            const workspaceId = workspace.workspace!.id

            await runtime.step({
              name: 'trigger-real-prepare-error',
              message: '通过 UI 点击更新索引，让真实坏 docx 文件进入文件级失败状态。',
              run: async () => {
                await navigateToSettingsSection(page, 'workspace')
                await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).waitFor(
                  {
                    state: 'visible'
                  }
                )
                await getSettingsLocator(page, importSelectors.workspaceQuickPrepareButton).click()
              }
            })

            const result = await waitForFileIndexJobIdle(page, workspaceId)
            const counts = await getWorkspaceIndexCounts(page)
            const treeText =
              (await getSettingsLocator(page, importSelectors.workspaceTree).textContent()) || ''
            const failedItems = toSupportedFileStatuses(result.tree).filter(
              (item) => item.status === 'failed'
            )

            return {
              summary: result.tree.summary,
              counts,
              treeText,
              failedItems
            }
          } finally {
            if (workspaceRoot) {
              await cleanupRealWorkspace(workspaceRoot)
            }
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
              result.failedItems[0]?.name === 'broken.docx' &&
              result.failedItems[0]?.lastError.length > 0,
            {
              name: 'file-level-failure-state-is-preserved',
              message:
                '文件索引失败后，应在文件级状态里保留失败标记和错误信息，对齐 SET-WORKSPACE-008-AC2。',
              data: result
            }
          )

          await runtime.assertThat(!result.treeText.includes('/'), {
            name: 'workspace-tree-removes-file-subtitle-path',
            message: '目录树文件项不应再展示文件名下方的路径辅助字项，对齐 SET-WORKSPACE-008-AC2。',
            data: result
          })
        }
      })
    },
    SETTINGS_REAL_WORKSPACE_E2E_TIMEOUT_MS
  )
})
