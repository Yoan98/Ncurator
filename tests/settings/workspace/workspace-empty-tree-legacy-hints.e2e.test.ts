import { describe, it } from 'vitest'
import type { WorkspaceSource } from '../../../src/shared/types'
import { importSelectors } from '../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../harness/e2e/settings'

const NOW = 1_710_100_000_000

const EMPTY_TREE_WORKSPACE: WorkspaceSource = {
  id: 'workspace-empty-tree',
  name: '空目录工作空间',
  root_path: '/tmp/ncurator-e2e-workspace-empty-tree',
  status: 'not_prepared',
  last_scan_at: NOW,
  created_at: NOW,
  updated_at: NOW
}

describe('settings workspace e2e', () => {
  it('workspace-empty-tree-legacy-hints', async () => {
    await runE2ECase({
      caseId: 'workspace-empty-tree-legacy-hints',
      domain: 'settings',
      suite: 'workspace',
      description: '工作空间页在无工作空间、无可追踪文件和旧数据迁移三类场景下展示明确提示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'show-empty-tree-and-legacy-hint',
          message: '注入空目录工作空间与旧本地导入迁移提示，并进入工作空间页。',
          run: async () => {
            await navigateToSettingsSection(page, 'model')
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: [EMPTY_TREE_WORKSPACE],
                total: 1
              },
              workspaceNodesResponseByWorkspaceId: {
                'workspace-empty-tree': {
                  items: [],
                  total: 0
                }
              },
              legacyLocalImportMigrationStatus: {
                hasLegacyLocalImports: true,
                removedDocumentCount: 2,
                removedChunkCount: 5
              }
            })
            await navigateToSettingsSection(page, 'workspace')
            await page.getByText('没有可追踪文件').waitFor({ state: 'visible' })
            await page.getByText('检测到旧本地导入记录').waitFor({ state: 'visible' })
          }
        })

        const emptyTreeVisible = await page.getByText('没有可追踪文件').isVisible()
        const legacyHintVisible = await page.getByText('检测到旧本地导入记录').isVisible()

        await runtime.step({
          name: 'show-no-workspace-empty-state',
          message: '切换到无工作空间响应并重新进入工作空间页，确认详情区不是空白。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: [],
                total: 0
              },
              workspaceNodesResponseByWorkspaceId: {},
              legacyLocalImportMigrationStatus: null
            })
            await navigateToSettingsSection(page, 'model')
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceEmptyState).waitFor({
              state: 'visible'
            })
          }
        })

        return {
          emptyTreeVisible,
          legacyHintVisible,
          noWorkspaceListVisible: await getSettingsLocator(
            page,
            importSelectors.workspaceEmptyState
          ).isVisible(),
          noWorkspaceDetailPromptVisible: await page.getByText('选择一个工作空间').isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.noWorkspaceListVisible && result.noWorkspaceDetailPromptVisible,
          {
            name: 'no-workspace-shows-explicit-empty-state',
            message:
              '没有工作空间时，详情区应展示明确空态提示，而不是空白页，对齐 SET-WORKSPACE-007-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.emptyTreeVisible, {
          name: 'empty-tree-shows-no-trackable-files-hint',
          message: '没有可追踪文件时，目录树区域应显示“没有可追踪文件”，对齐 SET-WORKSPACE-007-AC2。',
          data: result
        })

        await runtime.assertThat(result.legacyHintVisible, {
          name: 'legacy-imports-show-migration-hint',
          message: '检测到旧本地导入数据时，页面顶部应出现迁移清理提醒，对齐 SET-WORKSPACE-007-AC3。',
          data: result
        })
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
