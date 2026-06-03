import { describe, it } from 'vitest'
import type { WorkspaceListItem } from '../../../../src/shared/types'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../../harness/e2e/settings'

const NOW = 1_710_100_000_000

const EMPTY_TREE_WORKSPACE: WorkspaceListItem = {
  id: 'workspace-empty-tree',
  name: '空目录工作空间',
  root_path: '/tmp/ncurator-e2e-workspace-empty-tree',
  file_count: 0,
  web_count: 0,
  created_at: NOW,
  updated_at: NOW
}

describe('settings workspace e2e', () => {
  it('workspace-empty-tree-legacy-hints', async () => {
    await runE2ECase({
      caseId: 'workspace-empty-tree-legacy-hints',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '无工作空间、空目录树和旧数据迁移三类提示都能被明确展示。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'show-empty-tree-and-legacy-hint',
          message: '先注入空目录工作空间与旧导入迁移提示，确认目录树空态和提醒可见。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: [EMPTY_TREE_WORKSPACE],
                total: 1
              },
              workspaceTreeResponseByWorkspaceId: {
                'workspace-empty-tree': {
                  items: [],
                  total: 0,
                  summary: {
                    file_count: 0,
                    indexed_file_count: 0,
                    needs_index_count: 0,
                    failed_file_count: 0
                  }
                }
              },
              legacyLocalImportMigrationStatus: {
                hasLegacyLocalImports: true,
                removedDocumentCount: 2,
                removedChunkCount: 5
              }
            })
            await navigateToSettingsSection(page, 'workspace')
            await page.getByText('当前目录没有可显示文件').waitFor({ state: 'visible' })
            await page.getByText('检测到旧本地导入记录').waitFor({ state: 'visible' })
          }
        })

        const emptyTreeVisible = await page.getByText('当前目录没有可显示文件').isVisible()
        const legacyHintVisible = await page.getByText('检测到旧本地导入记录').isVisible()

        await runtime.step({
          name: 'show-no-workspace-empty-state',
          message: '再切到无工作空间响应，确认左侧和详情区都给出明确空态。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: [],
                total: 0
              },
              workspaceTreeResponseByWorkspaceId: {},
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
              '没有工作空间时，左侧列表和详情区都应呈现明确空态，而不是空白页，对齐 SET-WORKSPACE-007-AC1。',
            data: result
          }
        )

        await runtime.assertThat(result.emptyTreeVisible, {
          name: 'empty-tree-shows-file-empty-state',
          message: '当前目录没有可显示文件时，目录树区域应展示明确空态，对齐 SET-WORKSPACE-007-AC2。',
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
