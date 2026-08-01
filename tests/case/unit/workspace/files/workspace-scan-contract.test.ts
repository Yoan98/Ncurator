import { describe, it } from 'vitest'
import path from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('unit workspace backend', () => {
  it('workspace-scan-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-scan-contract',
      harnessMode: 'tool-real',
      domain: 'unit',
      suite: 'workspace',
      groups: ['files'],
      description: '工作空间扫描服务生成文件索引记录，并由派生摘要支撑页面刷新。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const now = Date.now()
        await mkdir(path.join(runtime.workspaceRoot, '.git'), { recursive: true })
        await mkdir(path.join(runtime.workspaceRoot, 'node_modules'), { recursive: true })
        await mkdir(path.join(runtime.workspaceRoot, 'visible', 'deep'), { recursive: true })
        await mkdir(path.join(runtime.workspaceRoot, '工作', '.drafts'), { recursive: true })
        await writeFile(path.join(runtime.workspaceRoot, '.env'), 'SECRET=hidden\n')
        await writeFile(path.join(runtime.workspaceRoot, '.git', 'config'), '[core]\n')
        await writeFile(path.join(runtime.workspaceRoot, 'node_modules', 'noise.js'), 'noise\n')
        await writeFile(path.join(runtime.workspaceRoot, 'visible', 'deep', 'leaf.txt'), 'leaf\n')
        await writeFile(
          path.join(runtime.workspaceRoot, '工作', '.drafts', 'hidden.md'),
          'hidden\n'
        )
        const scanResult = await runtime.workspaceSourceService.scanWorkspaceTree({
          workspaceId: 'workspace-scan-contract',
          rootPath: runtime.workspaceRoot,
          workspaceName: '扫描契约工作区',
          now
        })
        const records = scanResult.entries
          .filter((entry) => entry.kind === 'file' && entry.supported_for_index)
          .map((entry) =>
            runtime.workspaceSourceService.buildWorkspaceFileIndexRecord({
              workspaceId: scanResult.workspace.id,
              entry,
              now
            })
          )
        const hiddenDiff = await runtime.workspaceSourceService.diffWorkspaceTreeAgainstIndex({
          entries: scanResult.entries,
          records: [
            {
              id: 'hidden-env-record',
              workspace_id: scanResult.workspace.id,
              relative_path: '.env',
              absolute_path: path.join(runtime.workspaceRoot, '.env'),
              name: '.env',
              file_ext: 'env',
              size: 14,
              mtime_ms: now,
              index_status: 'indexed',
              document_id: 'hidden-env-doc',
              indexed_at: now,
              last_checked_at: now,
              created_at: now,
              updated_at: now
            }
          ]
        })

        await runtime.storageService.workspace.saveWorkspace(scanResult.workspace)
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(
          scanResult.workspace.id,
          records
        )

        const savedWorkspace = await runtime.storageService.workspace.getWorkspaceById(
          scanResult.workspace.id
        )
        const savedRecords = await runtime.storageService.workspace.listWorkspaceFileIndexRecords(
          scanResult.workspace.id
        )
        const fileSummary = await runtime.storageService.workspace.getWorkspaceFileSummary(
          scanResult.workspace.id
        )
        const nowForJob = Date.now()
        const job = {
          id: 'workspace-scan-contract-job',
          workspace_id: scanResult.workspace.id,
          source_kind: 'file' as const,
          action: 'scan' as const,
          status: 'running' as const,
          phase: 'scan' as const,
          step_index: 1,
          step_total: 1,
          total_count: records.length,
          processed_count: 0,
          failed_count: 0,
          target_ids: records.map((record) => record.id),
          message: '检查目录变化',
          started_at: nowForJob,
          updated_at: nowForJob
        }
        await runtime.storageService.workspaceIndexJob.saveJob(job)
        const activeJob = await runtime.storageService.workspaceIndexJob.getActiveJob(
          scanResult.workspace.id,
          'file'
        )
        const rootDirectory = await runtime.workspaceSourceService.listDirectory({
          workspaceId: scanResult.workspace.id,
          rootPath: runtime.workspaceRoot
        })
        const nestedDirectory = await runtime.workspaceSourceService.listDirectory({
          workspaceId: scanResult.workspace.id,
          rootPath: runtime.workspaceRoot,
          relativePath: '工作'
        })

        return {
          activeJob,
          savedWorkspace,
          fileSummary,
          scannedPaths: scanResult.entries.map((entry) => entry.relative_path),
          indexedPaths: savedRecords.map((record) => record.relative_path),
          removedHiddenPaths: hiddenDiff.removed.map((record) => record.relative_path),
          rootDirectoryPaths: rootDirectory.map((entry) => entry.relative_path),
          nestedDirectoryPaths: nestedDirectory.map((entry) => entry.relative_path),
          visibleDirectoryPaths: (
            await runtime.workspaceSourceService.listDirectory({
              workspaceId: scanResult.workspace.id,
              rootPath: runtime.workspaceRoot,
              relativePath: 'visible'
            })
          ).map((entry) => entry.relative_path),
          deepDirectoryPaths: (
            await runtime.workspaceSourceService.listDirectory({
              workspaceId: scanResult.workspace.id,
              rootPath: runtime.workspaceRoot,
              relativePath: 'visible/deep'
            })
          ).map((entry) => entry.relative_path),
          modulesDirectoryPaths: (
            await runtime.workspaceSourceService.listDirectory({
              workspaceId: scanResult.workspace.id,
              rootPath: runtime.workspaceRoot,
              relativePath: 'node_modules'
            })
          ).map((entry) => entry.relative_path)
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.activeJob?.status === 'running' &&
            result.activeJob.phase === 'scan' &&
            result.activeJob.total_count === result.fileSummary.file_count,
          {
            name: 'workspace-scan-creates-persistent-job',
            message:
              '检查目录变化应具备可用于页面恢复的持久化 job 信息，对齐 SET-WORKSPACE-003-AC1、SET-WORKSPACE-003-AC3。',
            data: result
          }
        )

        runtime.assertThat(
          !result.rootDirectoryPaths.some((item) => item.startsWith('.')) &&
            result.rootDirectoryPaths.includes('node_modules') &&
            result.rootDirectoryPaths.includes('工作') &&
            !result.nestedDirectoryPaths.some((item) => item.includes('.drafts')) &&
            !result.rootDirectoryPaths.includes('visible/deep') &&
            result.visibleDirectoryPaths.includes('visible/deep') &&
            !result.visibleDirectoryPaths.includes('visible/deep/leaf.txt') &&
            result.deepDirectoryPaths.includes('visible/deep/leaf.txt') &&
            result.modulesDirectoryPaths.includes('node_modules/noise.js'),
          {
            name: 'workspace-directory-list-is-lazy-and-filters-noise',
            message: '目录读取应只返回直属子项，隐藏点开头项，并保留非隐藏目录的可见性。',
            data: result
          }
        )

        runtime.assertThat(
          Boolean(result.savedWorkspace?.root_path) &&
            !('status' in (result.savedWorkspace || {})) &&
            result.fileSummary.file_count === result.activeJob?.total_count,
          {
            name: 'workspace-scan-derives-summary-from-file-index',
            message:
              '扫描成功后，工作空间本体只保留容器信息，文件数量与可索引摘要由文件索引记录派生，对齐 SET-WORKSPACE-003-AC2、SET-WORKSPACE-005-AC2。',
            data: result
          }
        )

        runtime.assertThat(
          !result.scannedPaths.some((item) =>
            item
              .split('/')
              .filter(Boolean)
              .some((segment) => segment.startsWith('.'))
          ) &&
            !result.indexedPaths.some((item) =>
              item
                .split('/')
                .filter(Boolean)
                .some((segment) => segment.startsWith('.'))
            ),
          {
            name: 'workspace-scan-skips-hidden-paths-at-source',
            message:
              '工作空间扫描应从源头跳过隐藏文件和隐藏目录，避免进入目录树、文件索引和后续知识库准备流程。',
            data: {
              scannedPaths: result.scannedPaths,
              indexedPaths: result.indexedPaths
            }
          }
        )

        runtime.assertThat(result.removedHiddenPaths.includes('.env'), {
          name: 'workspace-scan-diff-removes-existing-hidden-index-records',
          message:
            '如果旧索引里已经有隐藏文件，下次扫描 diff 应把它当作已移除，便于清理旧知识库记录。',
          data: result.removedHiddenPaths
        })
      }
    })
  })
})
