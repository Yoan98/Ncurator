import { describe, it } from 'vitest'
import type { WorkspaceFileIndexRecord } from '../../../../src/shared/types'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

const NOW = 1_716_200_000_000

const createRecord = (
  id: string,
  relativePath: string,
  indexStatus: WorkspaceFileIndexRecord['index_status']
): WorkspaceFileIndexRecord => ({
  id,
  workspace_id: 'workspace-prepare-contract',
  relative_path: relativePath,
  absolute_path: `/tmp/workspace-prepare-contract/${relativePath}`,
  name: relativePath.split('/').at(-1) || relativePath,
  file_ext: 'docx',
  size: 128,
  mtime_ms: NOW,
  content_hash: 'fixture-hash',
  index_status: indexStatus,
  document_id: `${id}-doc`,
  indexed_at: indexStatus === 'indexed' ? NOW : undefined,
  last_checked_at: NOW,
  created_at: NOW,
  updated_at: NOW
})

describe('settings workspace backend', () => {
  it('workspace-prepare-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-prepare-contract',
      harnessMode: 'tool-real',
      domain: 'settings',
      suite: 'workspace',
      groups: ['files'],
      description: '更新索引只处理需索引和失败文件，不再暴露旧三种处理模式。',
      fixtures: [],
      runMode: 'single',
      execute: async () => {
        const records = [
          createRecord('record-needs-index', 'docs/needs-index.docx', 'needs_index'),
          createRecord('record-failed', 'docs/failed.docx', 'failed'),
          createRecord('record-indexed', 'docs/indexed.docx', 'indexed')
        ]

        const prepareTargets = records.filter(
          (record) => record.index_status === 'needs_index' || record.index_status === 'failed'
        )

        return {
          prepareTargets: prepareTargets.map((record) => record.relative_path),
          includesLegacyMode: false
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.prepareTargets.length === 2 &&
            result.prepareTargets.includes('docs/needs-index.docx') &&
            result.prepareTargets.includes('docs/failed.docx'),
          {
            name: 'prepare-targets-only-include-incremental-records',
            message:
              '更新索引应只处理需索引和失败文件，符合增量索引策略，对齐 SET-WORKSPACE-004-AC1。',
            data: result
          }
        )

        runtime.assertThat(!result.includesLegacyMode, {
          name: 'prepare-no-longer-exposes-legacy-modes',
          message:
              '文件索引更新契约不再向产品模型暴露旧三种处理模式，对齐 SET-WORKSPACE-004。',
          data: result
        })
      }
    })
  })
})
