import { describe, it } from 'vitest'
import path from 'node:path'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  listReferenceItemsPage,
  type ReferenceListDeps
} from '../../../../src/main/services/sourceScope/referenceList'
import { pruneBlacklistedWorkspaceFiles } from '../../../../src/main/services/workspace/workspaceEntryBlacklist'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('unit workspace backend', () => {
  it('workspace-scan-contract', async () => {
    await runBackendCase({
      caseId: 'workspace-scan-contract',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '工作空间扫描服务生成文件索引记录，并由派生摘要支撑页面刷新。',
      fixtures: ['tests/fixtures/workspace'],
      runMode: 'single',
      execute: async (runtime) => {
        const now = Date.now()
        const scanProgress: Array<{ scannedEntryCount: number; supportedFileCount: number }> = []
        const diffProgress: Array<{ processedCount: number; totalCount: number }> = []
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
        const ignoredFilePaths = [
          '.private/notes.md',
          'node_modules/guide.md',
          'bower_components/guide.md',
          '__pycache__/guide.md',
          '__pypackages__/guide.md',
          'venv/guide.md',
          'coverage/guide.md',
          'htmlcov/guide.md',
          'playwright-report/guide.md',
          '__MACOSX/guide.md',
          'visible/deep/node_modules/guide.md',
          'python-env/deep/guide.md'
        ]
        const keptFilePaths = [
          'node_modules_backup/guide.md',
          'build/report.txt',
          'dist/report.txt',
          'out/report.txt',
          'target/report.txt',
          'vendor/guide.md',
          'bin/guide.md',
          'obj/guide.md',
          'coverage.txt',
          '~$notes.txt',
          'ordinary-env/guide.md'
        ]
        for (const relativePath of [...ignoredFilePaths, ...keptFilePaths]) {
          const absolutePath = path.join(runtime.workspaceRoot, relativePath)
          await mkdir(path.dirname(absolutePath), { recursive: true })
          await writeFile(absolutePath, 'workspace blacklist contract\n')
        }
        await writeFile(
          path.join(runtime.workspaceRoot, 'python-env', 'pyvenv.cfg'),
          'home = python\n'
        )
        await mkdir(path.join(runtime.workspaceRoot, 'ordinary-env', 'pyvenv.cfg'))
        const scanResult = await runtime.workspaceSourceService.scanWorkspaceTree({
          workspaceId: 'workspace-scan-contract',
          rootPath: runtime.workspaceRoot,
          now,
          onProgress: (progress) => {
            scanProgress.push({ ...progress })
          }
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
        const ignoredRecords = ignoredFilePaths.map((relativePath, index) => ({
          id: `ignored-record-${index}`,
          workspace_id: scanResult.workspace.id,
          relative_path: relativePath,
          absolute_path: path.join(runtime.workspaceRoot, relativePath),
          name: path.basename(relativePath),
          file_ext: 'md',
          index_status: 'indexed' as const,
          document_id: `ignored-document-${index}`,
          created_at: now,
          updated_at: now
        }))
        const hiddenDiff = await runtime.workspaceSourceService.diffWorkspaceTreeAgainstIndex({
          entries: scanResult.entries,
          records: [
            ...ignoredRecords,
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
          ],
          onProgress: (progress) => {
            diffProgress.push(progress)
          }
        })

        await runtime.storageService.workspace.saveWorkspace(scanResult.workspace)
        await runtime.storageService.workspace.replaceWorkspaceFileIndexRecords(
          scanResult.workspace.id,
          [...records, ...ignoredRecords]
        )
        const documents = runtime.storageService.documents
        const legacyDocuments = ignoredRecords.map((record) => ({
          id: record.document_id,
          name: record.name,
          source_type: 'file' as const,
          workspace_id: scanResult.workspace.id,
          file_path: record.absolute_path,
          import_status: 2,
          active_generation_id: 'blacklist-old-generation',
          created_at: now
        }))
        legacyDocuments.push({
          ...legacyDocuments[0],
          id: 'ignored-orphan-document',
          file_path: path.join(runtime.workspaceRoot, 'node_modules', 'orphan.md')
        })
        for (const document of legacyDocuments) await documents.addDocument(document)
        await documents.addChunks({
          chunks: legacyDocuments.map((document) => ({
            id: `${document.id}-chunk`,
            document_id: document.id,
            document_name: document.name,
            workspace_id: scanResult.workspace.id,
            source_type: 'file' as const,
            text: 'blacklistlegacycontent',
            metadata: { page: 1 }
          })),
          vectors: legacyDocuments.map(() => new Float32Array(768).fill(1)),
          generationId: 'blacklist-old-generation'
        })
        const ignoredDocumentIds = legacyDocuments.map((document) => document.id)
        const oldChunkCount = await documents.countChunksByDocumentIds(ignoredDocumentIds)
        await runtime.storageService.close()
        await runtime.storageService.initialize()
        await pruneBlacklistedWorkspaceFiles({
          workspaceStore: runtime.storageService.workspace,
          documentsStore: documents
        })
        const oldDocumentsAfterCleanup = await documents.listDocumentsBySourceType(
          'file',
          scanResult.workspace.id
        )
        const oldChunkCountAfterCleanup =
          await documents.countChunksByDocumentIds(ignoredDocumentIds)
        const oldSearchResults = await documents.ftsSearch('blacklistlegacycontent')

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
          step_total: 2,
          total_count: 0,
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
        for (const name of ['node_modules', 'python-env', '.private']) {
          await runtime.storageService.workspace.saveWorkspace({
            id: `ignored-root-${name}`,
            root_path: path.join(runtime.workspaceRoot, name),
            created_at: now,
            updated_at: now
          })
        }
        const referenceDeps: ReferenceListDeps = {
          listWorkspaces: () => runtime.storageService.workspace.listWorkspaces(),
          listWorkspaceFileIndexRecords: (workspaceId) =>
            runtime.storageService.workspace.listWorkspaceFileIndexRecords(workspaceId),
          listDirectory: (input) => runtime.workspaceSourceService.listDirectory(input),
          listWebSources: async () => [],
          normalizeWorkspaceRoot: (rootPath) =>
            runtime.workspaceSourceService.normalizeWorkspaceRoot(rootPath)
        }
        const referencePaths: string[] = []
        let referenceOffset = 0
        for (;;) {
          const references = await listReferenceItemsPage(
            referenceDeps,
            { offset: referenceOffset },
            null
          )
          referencePaths.push(
            ...references.items
              .filter((item) => item.kind !== 'web')
              .map((item) => item.relativePath)
          )
          if (!references.hasMore) break
          referenceOffset += references.items.length
        }
        const nameSearch = await listReferenceItemsPage(
          referenceDeps,
          { query: 'node_modules' },
          null
        )
        const markerSearch = await listReferenceItemsPage(
          referenceDeps,
          { query: 'python-env' },
          null
        )
        await rm(path.join(runtime.workspaceRoot, 'python-env', 'pyvenv.cfg'))
        const afterMarkerRemoval = await runtime.workspaceSourceService.listDirectory({
          workspaceId: scanResult.workspace.id,
          rootPath: runtime.workspaceRoot
        })
        await writeFile(
          path.join(runtime.workspaceRoot, 'python-env', 'pyvenv.cfg'),
          'home = python\n'
        )

        return {
          ignoredFilePaths,
          keptFilePaths,
          oldChunkCount,
          oldDocumentsAfterCleanup,
          oldChunkCountAfterCleanup,
          oldSearchResults,
          sourceAfterCleanup: await readFile(
            path.join(runtime.workspaceRoot, 'node_modules', 'guide.md'),
            'utf8'
          ),
          referencePaths,
          nameSearchPaths: nameSearch.items
            .filter((item) => item.kind !== 'web')
            .map((item) => item.relativePath),
          markerSearchCount: markerSearch.total,
          afterMarkerRemovalPaths: afterMarkerRemoval.map((entry) => entry.relative_path),
          activeJob,
          scanProgress,
          diffProgress,
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
            result.activeJob.step_total === 2 &&
            result.activeJob.total_count === 0,
          {
            name: 'workspace-scan-creates-persistent-job',
            message:
              '检查目录变化应具备可用于页面恢复的持久化 job 信息，对齐 SET-WORKSPACE-003-AC1、SET-WORKSPACE-003-AC3。',
            data: result
          }
        )

        runtime.assertThat(
          result.scanProgress.length > 0 &&
            result.scanProgress.at(-1)?.scannedEntryCount === result.scannedPaths.length &&
            result.scanProgress.at(-1)?.supportedFileCount === result.indexedPaths.length,
          {
            name: 'workspace-scan-reports-discovery-progress',
            message:
              '目录扫描应持续上报已扫描条目与已发现可索引文件数量，供未知总量阶段展示真实活动进度，对齐 SET-WORKSPACE-003-AC5。',
            data: result.scanProgress
          }
        )

        runtime.assertThat(
          result.diffProgress.length > 0 &&
            result.diffProgress.at(-1)?.processedCount === result.indexedPaths.length &&
            result.diffProgress.at(-1)?.totalCount === result.indexedPaths.length,
          {
            name: 'workspace-scan-reports-determinate-diff-progress',
            message:
              '目录扫描结束后，比对索引阶段必须以已发现的可索引文件总数上报确定进度，对齐 SET-WORKSPACE-003-AC5。',
            data: result.diffProgress
          }
        )

        runtime.assertThat(
          !result.rootDirectoryPaths.some((item) => item.startsWith('.')) &&
            !result.rootDirectoryPaths.includes('node_modules') &&
            result.rootDirectoryPaths.includes('工作') &&
            !result.nestedDirectoryPaths.some((item) => item.includes('.drafts')) &&
            !result.rootDirectoryPaths.includes('visible/deep') &&
            result.visibleDirectoryPaths.includes('visible/deep') &&
            !result.visibleDirectoryPaths.includes('visible/deep/leaf.txt') &&
            result.deepDirectoryPaths.includes('visible/deep/leaf.txt') &&
            result.modulesDirectoryPaths.length === 0,
          {
            name: 'workspace-directory-list-is-lazy-and-filters-noise',
            message: '目录读取应只返回直属子项，并按工作空间黑名单隐藏目录及其全部内容。',
            data: result
          }
        )

        runtime.assertThat(
          Boolean(result.savedWorkspace?.root_path) &&
            !('status' in (result.savedWorkspace || {})) &&
            result.fileSummary.file_count === result.indexedPaths.length,
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
        runtime.assertThat(
          result.ignoredFilePaths.every(
            (item) =>
              !result.scannedPaths.includes(item) &&
              !result.indexedPaths.includes(item) &&
              result.removedHiddenPaths.includes(item)
          ) &&
            !result.rootDirectoryPaths.includes('python-env') &&
            result.keptFilePaths.every((item) => result.indexedPaths.includes(item)) &&
            result.afterMarkerRemovalPaths.includes('python-env'),
          {
            name: 'workspace-blacklist-filters-subtrees-and-rechecks-markers',
            message:
              '黑名单在任意层级生效，保留普通构建目录与相似名称，特征文件移除后下次读取生效，对齐 SET-WORKSPACE-008-AC8。',
            data: result
          }
        )
        runtime.assertThat(
          result.oldChunkCount === result.ignoredFilePaths.length + 1 &&
            result.oldDocumentsAfterCleanup.length === 0 &&
            result.oldChunkCountAfterCleanup === 0 &&
            result.oldSearchResults.length === 0 &&
            result.sourceAfterCleanup === 'workspace blacklist contract\n',
          {
            name: 'workspace-blacklist-cleans-persisted-indexes-on-startup',
            message:
              '启动清理移除旧文件索引、文档及向量块，重复清理保持一致，对齐 SET-WORKSPACE-008-AC9。',
            data: result
          }
        )
        runtime.assertThat(
          !result.referencePaths.includes('node_modules') &&
            !result.referencePaths.includes('python-env') &&
            result.referencePaths.filter((item) => item === '').length === 1 &&
            result.ignoredFilePaths.every((item) => !result.referencePaths.includes(item)) &&
            result.keptFilePaths.every((item) => result.referencePaths.includes(item)) &&
            result.nameSearchPaths.includes('node_modules_backup/guide.md') &&
            result.nameSearchPaths.every((item) =>
              ['node_modules_backup', 'node_modules_backup/guide.md'].includes(item)
            ) &&
            result.markerSearchCount === 0 &&
            !result.referencePaths.some((item) =>
              item.split('/').some((name) => name.startsWith('.'))
            ),
          {
            name: 'workspace-blacklist-filters-reference-discovery-and-search',
            message:
              '@ 候选和关键词搜索统一排除黑名单目录、虚拟环境及其内容，命中的工作地址根也被排除。',
            data: {
              referencePaths: result.referencePaths,
              nameSearchPaths: result.nameSearchPaths,
              markerSearchCount: result.markerSearchCount
            }
          }
        )
      }
    })
  })
})
