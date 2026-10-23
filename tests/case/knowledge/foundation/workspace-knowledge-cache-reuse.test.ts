import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { StorageService } from '../../../../src/main/services/storage/StorageService'
import { WorkspaceKnowledgePrepareService } from '../../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { createWorkspaceKnowledgeCache } from '../../../../src/main/services/workspace/WorkspaceKnowledgeCache'
import { prepareWorkspaceSource } from '../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge foundation', () => {
  it('workspace-knowledge-cache-reuse', async () => {
    await runBackendCase({
      caseId: 'workspace-knowledge-cache-reuse',
      harnessMode: 'tool-real',
      knowledge: 'cached',
      domain: 'knowledge',
      suite: 'foundation',
      description: '真实解析和嵌入只计算缺失条目；全新存储重绑当前工作区，改文及改名安全失效。',
      fixtures: ['tests/fixtures/workspace/工作/本周排期更新.txt'],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.prepareEmbeddingModel()
        const cache = createWorkspaceKnowledgeCache({
          root: path.join(runtime.workspaceRoot, '.computation-cache'),
          pipeline: JSON.parse(process.env.NCURATOR_KNOWLEDGE_IDENTITY!) as {
            split: string
            embedding: string
          }
        })!
        const firstFile = runtime.getFixtureWorkspacePath(
          'tests/fixtures/workspace/工作/本周排期更新.txt'
        )
        const sourceBytes = await fs.readFile(firstFile)
        const firstService = new WorkspaceKnowledgePrepareService({
          embeddingService: runtime.embeddingService,
          documentsStore: runtime.documentsStore,
          prepareSource: prepareWorkspaceSource
        })
        const first = await firstService.indexLocalFile({
          workspaceId: 'original-workspace',
          documentId: 'original-document',
          filePath: firstFile,
          documentName: path.basename(firstFile),
          cache
        })
        const secondRoot = path.join(runtime.workspaceRoot, 'fresh-workspace')
        await fs.mkdir(secondRoot)
        const secondFile = path.join(secondRoot, path.basename(firstFile))
        await fs.copyFile(firstFile, secondFile)
        const storage = new StorageService({
          sqlitePath: path.join(secondRoot, 'fresh.sqlite'),
          vectorPath: path.join(secondRoot, 'vectors')
        })
        await storage.initialize()
        try {
          const secondService = new WorkspaceKnowledgePrepareService({
            embeddingService: runtime.embeddingService,
            documentsStore: storage.documents,
            prepareSource: prepareWorkspaceSource
          })
          const second = await secondService.indexLocalFile({
            workspaceId: 'fresh-workspace',
            documentId: 'fresh-document',
            filePath: secondFile,
            documentName: path.basename(secondFile),
            cache
          })
          const bound = await storage.documents.getDocumentById('fresh-document')
          const old = await storage.documents.getDocumentById('original-document')
          await fs.appendFile(secondFile, '\n新增排期：复核结束后再确认发布。')
          const changed = await secondService.indexLocalFile({
            workspaceId: 'fresh-workspace',
            documentId: 'fresh-document',
            filePath: secondFile,
            documentName: path.basename(secondFile),
            cache
          })
          const renamedFile = path.join(secondRoot, '最新排期.txt')
          await fs.rename(secondFile, renamedFile)
          const renamed = await secondService.indexLocalFile({
            workspaceId: 'fresh-workspace',
            documentId: 'renamed-document',
            filePath: renamedFile,
            documentName: '最新排期.txt',
            cache
          })
          return {
            first,
            second,
            changed,
            renamed,
            bound,
            old,
            sourcePreserved: Buffer.compare(sourceBytes, await fs.readFile(firstFile)) === 0
          }
        } finally {
          await storage.close()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          !result.first.usedCachedSplit &&
            !result.first.usedCachedVectors &&
            result.second.usedCachedSplit &&
            result.second.usedCachedVectors,
          {
            name: 'cold-then-hot-real-index',
            message: '首轮真实计算，第二个全新工作区完全命中切片与向量缓存。',
            data: { first: result.first, second: result.second }
          }
        )
        runtime.assertThat(
          result.bound?.workspace_id === 'fresh-workspace' &&
            result.bound.file_path === result.second.filePath &&
            !result.old &&
            result.second.generationId !== result.first.generationId &&
            result.second.chunks.every(
              (chunk) => !result.first.chunks.some((old) => old.id === chunk.id)
            ),
          {
            name: 'isolated-store-rebinding',
            message: '只复用计算结果；新 SQLite/LanceDB、文档、generation 与 chunk ID 均独立。'
          }
        )
        runtime.assertThat(
          !result.changed.usedCachedSplit &&
            !result.changed.usedCachedVectors &&
            !result.renamed.usedCachedSplit &&
            !result.renamed.usedCachedVectors &&
            result.sourcePreserved &&
            result.renamed.chunks.some((chunk) => chunk.text.includes('最新排期')),
          {
            name: 'content-and-anchor-invalidations',
            message: '改文失效，改名重新生成锚点与向量，原始资料未修改。'
          }
        )
      }
    })
  }, 300_000)
})
