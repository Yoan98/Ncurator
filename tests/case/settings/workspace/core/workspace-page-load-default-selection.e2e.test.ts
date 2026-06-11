import { describe, it } from 'vitest'
import type { WorkspaceListItem, WorkspaceTreeListResponse } from '../../../../../src/shared/types'
import { importSelectors } from '../../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides,
  workspaceCardLocator
} from '../../../../harness/e2e/settings'

const NOW = 1_710_000_000_000

const WORKSPACES: WorkspaceListItem[] = [
  {
    id: 'workspace-first',
    name: '第一个工作空间',
    root_path: '/tmp/ncurator-e2e-workspace-first',
    file_count: 2,
    web_count: 2,
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'workspace-second',
    name: '第二个工作空间',
    root_path: '/tmp/ncurator-e2e-workspace-second',
    file_count: 2,
    web_count: 0,
    created_at: NOW + 1,
    updated_at: NOW + 1
  }
]

const WORKSPACE_TREE_BY_ID: Record<string, WorkspaceTreeListResponse> = {
  'workspace-first': {
    items: [
      {
        id: 'workspace-first:directory:docs',
        workspace_id: 'workspace-first',
        kind: 'directory',
        name: 'docs',
        relative_path: 'docs',
        absolute_path: '/tmp/ncurator-e2e-workspace-first/docs',
        supported_for_index: false
      },
      {
        id: 'workspace-first:file:docs/brief.docx',
        workspace_id: 'workspace-first',
        parent_id: 'workspace-first:directory:docs',
        kind: 'file',
        name: 'brief.docx',
        relative_path: 'docs/brief.docx',
        absolute_path: '/tmp/ncurator-e2e-workspace-first/docs/brief.docx',
        file_ext: 'docx',
        supported_for_index: true,
        size: 128,
        mtime_ms: NOW,
        index_status: 'needs_index'
      },
      {
        id: 'workspace-first:file:docs/5232b802-5483-4bbb-a344-1923330dd04b_深度学习.pdf',
        workspace_id: 'workspace-first',
        parent_id: 'workspace-first:directory:docs',
        kind: 'file',
        name: '5232b802-5483-4bbb-a344-1923330dd04b_深度学习.pdf',
        relative_path: 'docs/5232b802-5483-4bbb-a344-1923330dd04b_深度学习.pdf',
        absolute_path:
          '/tmp/ncurator-e2e-workspace-first/docs/5232b802-5483-4bbb-a344-1923330dd04b_深度学习.pdf',
        file_ext: 'pdf',
        supported_for_index: true,
        size: 4096,
        mtime_ms: NOW,
        index_status: 'failed'
      }
    ],
    total: 3,
    summary: {
      file_count: 2,
      indexed_file_count: 0,
      needs_index_count: 1,
      failed_file_count: 1
    }
  },
  'workspace-second': {
    items: [],
    total: 0,
    summary: {
      file_count: 0,
      indexed_file_count: 0,
      needs_index_count: 0,
      failed_file_count: 0
    }
  }
}

describe('settings workspace e2e', () => {
  it('workspace-page-load-default-selection', async () => {
    await runE2ECase({
      caseId: 'workspace-page-load-default-selection',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '工作空间页首屏初始化后，默认选中第一条工作空间并展示文件/网页 tab。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime

        await runtime.step({
          name: 'override-workspace-data',
          message: '注入工作空间列表与目录树响应，覆盖首屏默认选中场景。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: WORKSPACES,
                total: WORKSPACES.length
              },
              workspaceTreeResponseByWorkspaceId: WORKSPACE_TREE_BY_ID,
              legacyLocalImportMigrationStatus: null
            })
          }
        })

        await runtime.step({
          name: 'open-workspace-page',
          message: '进入工作空间页并等待第一条工作空间详情完成渲染。',
          run: async () => {
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceList).waitFor({ state: 'visible' })
            await workspaceCardLocator(page, 'workspace-first').waitFor({ state: 'visible' })
            await getSettingsLocator(page, importSelectors.workspaceDetail)
              .getByRole('heading', { name: '第一个工作空间' })
              .waitFor({ state: 'visible' })
          }
        })

        const firstWorkspaceCardText =
          (await workspaceCardLocator(page, 'workspace-first').textContent()) || ''
        const detailText =
          (await getSettingsLocator(page, importSelectors.workspaceDetail).textContent()) || ''
        const longPdfRow = getSettingsLocator(page, importSelectors.workspaceTree).getByText(
          '5232b802-5483-4bbb-a344-1923330dd04b_深度学习.pdf'
        )
        const treeBox = await getSettingsLocator(page, importSelectors.workspaceTree).boundingBox()
        const failedTagBox = await getSettingsLocator(page, importSelectors.workspaceTree)
          .getByText('失败')
          .boundingBox()
        const longPdfNameIsTruncated = await longPdfRow.evaluate((element) => {
          return element.scrollWidth > element.clientWidth
        })

        return {
          firstWorkspaceCardText,
          detailText,
          firstHeadingVisible: await getSettingsLocator(page, importSelectors.workspaceDetail)
            .getByRole('heading', { name: '第一个工作空间' })
            .isVisible(),
          treeHasBrief: detailText.includes('brief.docx'),
          longPdfTextVisible: await longPdfRow.isVisible(),
          longPdfNameIsTruncated,
          failedTagVisible: await getSettingsLocator(page, importSelectors.workspaceTree)
            .getByText('失败')
            .isVisible(),
          failedTagWithinTree:
            Boolean(treeBox && failedTagBox) &&
            Number(failedTagBox?.x) >= Number(treeBox?.x) &&
            Number(failedTagBox?.x) + Number(failedTagBox?.width) <=
              Number(treeBox?.x) + Number(treeBox?.width),
          fileTabVisible: await page.getByRole('tab', { name: '文件 2' }).isVisible(),
          webTabVisible: await page.getByRole('tab', { name: '网页 2' }).isVisible()
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.firstHeadingVisible && result.fileTabVisible && result.webTabVisible,
          {
            name: 'workspace-page-loads-list-and-detail',
            message:
              '页面打开后应完成工作空间列表和详情区初始化，并直接呈现文件 / 网页 tab，对齐 SET-WORKSPACE-001-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.firstWorkspaceCardText.includes('2') &&
            result.treeHasBrief,
          {
            name: 'workspace-defaults-to-first-item',
            message:
              '未显式选中时应默认落到第一条工作空间，并能在左侧表达文件数与网页数、右侧展示当前文件树，对齐 SET-WORKSPACE-001-AC2、SET-WORKSPACE-005-AC4。',
            data: result
          }
        )

        await runtime.assertThat(
          result.longPdfTextVisible &&
            result.failedTagVisible &&
            result.longPdfNameIsTruncated &&
            result.failedTagWithinTree,
          {
            name: 'workspace-tree-long-file-name-keeps-status-visible',
            message:
              '目录树长文件名应在有限宽度内省略显示，不能把失败状态挤出可视区域，对齐 SET-WORKSPACE-008-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
