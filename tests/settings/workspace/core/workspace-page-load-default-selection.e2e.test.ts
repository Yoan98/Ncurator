import { describe, it } from 'vitest'
import type { WorkspaceNode, WorkspaceSource } from '../../../../src/shared/types'
import { importSelectors } from '../../../../src/renderer/src/testing/selectors'
import { runE2ECase } from '../../../harness/e2e/run-e2e-case'
import {
  SETTINGS_E2E_TIMEOUT_MS,
  getSettingsLocator,
  getSettingsPrefixLocator,
  navigateToSettingsSection,
  setSettingsE2EApiOverrides
} from '../../../harness/e2e/settings'

const NOW = 1_710_000_000_000

const WORKSPACES: readonly WorkspaceSource[] = [
  {
    id: 'workspace-first',
    name: '第一个工作空间',
    root_path: '/tmp/ncurator-e2e-workspace-first',
    status: 'stale',
    last_scan_at: NOW,
    created_at: NOW,
    updated_at: NOW
  },
  {
    id: 'workspace-second',
    name: '第二个工作空间',
    root_path: '/tmp/ncurator-e2e-workspace-second',
    status: 'prepared',
    last_scan_at: NOW,
    last_prepare_at: NOW,
    created_at: NOW,
    updated_at: NOW
  }
]

const WORKSPACE_NODES: Record<string, WorkspaceNode[]> = {
  'workspace-first': [
    {
      id: 'workspace-first-dir',
      workspace_id: 'workspace-first',
      kind: 'directory',
      name: 'docs',
      relative_path: 'docs',
      absolute_path: '/tmp/ncurator-e2e-workspace-first/docs',
      exists: true,
      prepare_status: 'not_prepared',
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: 'workspace-first-file',
      workspace_id: 'workspace-first',
      parent_id: 'workspace-first-dir',
      kind: 'file',
      name: 'brief.docx',
      relative_path: 'docs/brief.docx',
      absolute_path: '/tmp/ncurator-e2e-workspace-first/docs/brief.docx',
      file_ext: '.docx',
      exists: true,
      size: 128,
      prepare_status: 'not_prepared',
      created_at: NOW,
      updated_at: NOW
    }
  ],
  'workspace-second': [
    {
      id: 'workspace-second-dir',
      workspace_id: 'workspace-second',
      kind: 'directory',
      name: 'refs',
      relative_path: 'refs',
      absolute_path: '/tmp/ncurator-e2e-workspace-second/refs',
      exists: true,
      prepare_status: 'not_prepared',
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: 'workspace-second-file-a',
      workspace_id: 'workspace-second',
      parent_id: 'workspace-second-dir',
      kind: 'file',
      name: 'alpha.pdf',
      relative_path: 'refs/alpha.pdf',
      absolute_path: '/tmp/ncurator-e2e-workspace-second/refs/alpha.pdf',
      file_ext: '.pdf',
      exists: true,
      size: 256,
      prepare_status: 'prepared',
      created_at: NOW,
      updated_at: NOW
    },
    {
      id: 'workspace-second-file-b',
      workspace_id: 'workspace-second',
      parent_id: 'workspace-second-dir',
      kind: 'file',
      name: 'beta.docx',
      relative_path: 'refs/beta.docx',
      absolute_path: '/tmp/ncurator-e2e-workspace-second/refs/beta.docx',
      file_ext: '.docx',
      exists: true,
      size: 512,
      prepare_status: 'prepared',
      created_at: NOW,
      updated_at: NOW
    }
  ]
}

describe('settings workspace e2e', () => {
  it('workspace-page-load-default-selection', async () => {
    await runE2ECase({
      caseId: 'workspace-page-load-default-selection',
      domain: 'settings',
      suite: 'workspace',
      groups: ['core'],
      description: '工作空间页首屏初始化后，默认选中第一条工作空间并展示其详情。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const { page } = runtime
        const workspaceDetail = getSettingsLocator(page, importSelectors.workspaceDetail)
        const workspaceTitle = workspaceDetail.getByRole('heading', { name: '第一个工作空间' })

        await runtime.step({
          name: 'override-workspace-responses',
          message: '注入两条工作空间及各自目录树响应。',
          run: async () => {
            await setSettingsE2EApiOverrides(page, {
              workspaceListResponse: {
                items: [...WORKSPACES],
                total: WORKSPACES.length
              },
              workspaceNodesResponseByWorkspaceId: {
                'workspace-first': {
                  items: WORKSPACE_NODES['workspace-first'],
                  total: WORKSPACE_NODES['workspace-first'].length
                },
                'workspace-second': {
                  items: WORKSPACE_NODES['workspace-second'],
                  total: WORKSPACE_NODES['workspace-second'].length
                }
              },
              legacyLocalImportMigrationStatus: null
            })
          }
        })

        await runtime.step({
          name: 'open-workspace-settings',
          message: '进入工作空间页并等待列表与详情初始化完成。',
          run: async () => {
            await navigateToSettingsSection(page, 'workspace')
            await getSettingsLocator(page, importSelectors.workspaceList).waitFor({ state: 'visible' })
            await getSettingsLocator(page, `${importSelectors.workspaceCardPrefix}-workspace-first`).waitFor({
              state: 'visible'
            })
            await workspaceTitle.waitFor({ state: 'visible' })
          }
        })

        return {
          cardCount: await getSettingsPrefixLocator(page, importSelectors.workspaceCardPrefix).count(),
          detailHasFirstWorkspace: await workspaceTitle.isVisible(),
          detailRootPathVisible: await workspaceDetail
            .getByText('/tmp/ncurator-e2e-workspace-first', { exact: true })
            .isVisible(),
          directoriesText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryDirectories).textContent()) ||
            '',
          filesText:
            (await getSettingsLocator(page, importSelectors.workspaceSummaryFiles).textContent()) || ''
        }
      },
      assert: async (result, runtime) => {
        await runtime.assertThat(
          result.cardCount === 2 && result.detailHasFirstWorkspace && result.detailRootPathVisible,
          {
            name: 'workspace-page-loads-list-and-detail',
            message:
              '页面打开后应完成工作空间列表与详情区初始化，不依赖手动刷新，对齐 SET-WORKSPACE-001-AC1。',
            data: result
          }
        )

        await runtime.assertThat(
          result.directoriesText.includes('1') && result.filesText.includes('1'),
          {
            name: 'workspace-defaults-to-first-item-detail',
            message:
              '当前未显式选中任何项时，应默认选中第一条工作空间并展示其状态与摘要，对齐 SET-WORKSPACE-001-AC2。',
            data: result
          }
        )
      }
    })
  }, SETTINGS_E2E_TIMEOUT_MS)
})
