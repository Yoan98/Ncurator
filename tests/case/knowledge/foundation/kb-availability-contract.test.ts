import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { createRetrievalToolHarness } from '../../../harness/backend/aiToolHarness'
import {
  withIsolatedModels,
  copyInstalledEmbeddingModel,
  writeCorruptEmbeddingModel
} from '../../../harness/backend/modelFixture'
import { ModelService } from '../../../../src/main/services/model/ModelService'
import { VectorModelDownloadService } from '../../../../src/main/services/model/VectorModelDownloadService'
import { DEFAULT_EMBEDDING_MODEL_NAME } from '../../../../src/main/services/vector/EmbeddingService'
import { LOCAL_EMBEDDING_MODEL_ID } from '../../../../src/shared/embeddingModels'
import { EmbeddingModelService } from '../../../../src/main/services/vector/EmbeddingModelService'
import { TransformersEmbeddingExecutor } from '../../../../src/main/services/vector/runtime/TransformersEmbeddingExecutor'
import { EMBEDDING_MODEL_NOT_INSTALLED_ERROR } from '../../../../src/main/services/vector/ensureEmbeddingReady'

describe('knowledge availability through real services', () => {
  it('kb-availability-contract', async () => {
    await withIsolatedModels(async (modelsPath, sharedModelsPath) => {
      await runBackendCase({
        caseId: 'kb-availability-contract',
        domain: 'knowledge',
        suite: 'foundation',
        harnessMode: 'tool-real',
        knowledge: 'cold',
        fixtures: [],
        runMode: 'single',
        description: '真实模型统一门禁、初始化失败、空库、全局网页、切换失效与恢复。',
        assert: async () => {},
        execute: async (runtime) => {
          const harness = createRetrievalToolHarness(runtime, { bindWorkspace: false })
          const modelPath = path.join(modelsPath, DEFAULT_EMBEDDING_MODEL_NAME)
          const modelService = ModelService.getInstance()
          const assertAllUnavailable = async () => {
            const before = await fs.readdir(modelsPath, { recursive: true })
            for (const strategy of ['auto', 'semantic', 'keyword']) {
              await expect(
                harness.invoke('kb_search', { queryText: '资料', strategy })
              ).rejects.toThrow(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
            }
            await expect(harness.invoke('kb_list_documents', {})).rejects.toThrow(
              EMBEDDING_MODEL_NOT_INSTALLED_ERROR
            )
            expect(runtime.embeddingService.getStatus()).toBe('uninitialized')
            expect(await fs.readdir(modelsPath, { recursive: true })).toEqual(before)
          }
          await assertAllUnavailable()
          await fs.mkdir(modelPath, { recursive: true })
          await fs.writeFile(path.join(modelPath, 'config.json'), '{}')
          await assertAllUnavailable()

          const sourcePath = path.join(runtime.workspaceRoot, 'source.txt')
          await fs.writeFile(sourcePath, '索引输入')
          await expect(
            runtime.workspaceKnowledgePrepareService.indexLocalFile({
              workspaceId: 'source',
              documentId: 'source',
              documentName: 'source.txt',
              filePath: sourcePath
            })
          ).rejects.toThrow(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
          await expect(
            runtime.workspaceKnowledgePrepareService.indexWebText({
              sourceType: 'web',
              workspaceId: '',
              documentId: 'web-source',
              documentName: '网页',
              sourceUrl: 'https://example.com/source',
              rawText: '网页输入',
              contentHash: 'web-hash'
            })
          ).rejects.toThrow(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
          expect(
            (await runtime.documentsStore.listDocuments({ page: 1, pageSize: 20 })).total
          ).toBe(0)

          await writeCorruptEmbeddingModel(modelsPath)
          await fs.writeFile(
            path.join(modelPath, '.download-state.json'),
            JSON.stringify({ repoId: DEFAULT_EMBEDDING_MODEL_NAME, completedFiles: [] })
          )
          expect(modelService.isModelDownloaded(DEFAULT_EMBEDDING_MODEL_NAME)).toBe(false)
          await assertAllUnavailable()
          await fs.rm(path.join(modelPath, '.download-state.json'))
          expect(modelService.isModelDownloaded(DEFAULT_EMBEDDING_MODEL_NAME)).toBe(true)
          await expect(
            harness.invoke('kb_search', { queryText: '资料', strategy: 'semantic' })
          ).rejects.toThrow('向量模型初始化失败')
          expect(runtime.embeddingService.getStatus()).toBe('error')
          await runtime.embeddingService.close()
          await fs.rm(modelPath, { recursive: true, force: true })

          await copyInstalledEmbeddingModel(modelsPath, sharedModelsPath)
          for (const strategy of ['auto', 'semantic', 'keyword']) {
            expect(
              await harness.invoke('kb_search', { queryText: '不存在的资料', strategy })
            ).toEqual({ items: [], total: 0 })
          }
          expect(await harness.invoke('kb_list_documents', {})).toEqual({ items: [], total: 0 })
          await runtime.seedKb([
            {
              id: 'global-web',
              name: '全局网页',
              sourceType: 'web',
              sourceUrl: 'https://example.com/global',
              chunks: [{ id: 'global-chunk', text: '全局网页包含知识库可用性边界资料。' }]
            }
          ])
          expect((await runtime.storageService.workspace.listWorkspaces()).length).toBe(0)
          const webResult = await harness.invoke<{
            items: Array<{ sourceUrl?: string }>
            total: number
          }>('kb_search', { queryText: '全局网页', strategy: 'auto', sourceType: 'web' })
          expect(webResult.total).toBeGreaterThan(0)
          expect(webResult.items[0].sourceUrl).toBe('https://example.com/global')
          for (const strategy of ['auto', 'semantic', 'keyword']) {
            for (const documentIds of [[], ['missing-document']]) {
              expect(
                await harness.invoke('kb_search', { queryText: '全局网页', strategy, documentIds })
              ).toEqual({ items: [], total: 0 })
            }
          }
          expect(
            await harness.invoke('kb_search', {
              queryText: 'NO_MATCH_XYZ_314159',
              strategy: 'keyword'
            })
          ).toMatchObject({ items: [], total: 0 })
          expect(
            await harness.invoke('kb_list_documents', { documentIds: ['missing-document'] })
          ).toEqual({ items: [], total: 0 })

          // 缓存不能绕过所有 KB 工具的模型检查。
          // Windows 的 ONNX 会占用模型目录，因此只移动必需的元数据文件。
          //
          // A cache must not bypass model checks on any KB tool.
          // ONNX holds the directory open on Windows, so move only required metadata.
          const configPath = path.join(modelPath, 'config.json')
          await fs.rename(configPath, `${configPath}-hidden`)
          try {
            await expect(
              harness.invoke('kb_search', { queryText: '全局网页', strategy: 'semantic' })
            ).rejects.toThrow(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
            await expect(
              harness.invoke('kb_search', { queryText: '全局网页', strategy: 'keyword' })
            ).rejects.toThrow(EMBEDDING_MODEL_NOT_INSTALLED_ERROR)
            await expect(harness.invoke('kb_list_documents', {})).rejects.toThrow(
              EMBEDDING_MODEL_NOT_INSTALLED_ERROR
            )
          } finally {
            await fs.rename(`${configPath}-hidden`, configPath)
          }
          const downloadService = VectorModelDownloadService.getInstance({
            modelService,
            embeddingService: runtime.embeddingService
          })
          expect(await downloadService.deleteModel(DEFAULT_EMBEDDING_MODEL_NAME)).toEqual({
            success: true
          })
          expect(runtime.embeddingService.getStatus()).toBe('uninitialized')
          await assertAllUnavailable()
          await copyInstalledEmbeddingModel(modelsPath, sharedModelsPath)
          expect(
            (
              await harness.invoke<{ items: Array<{ id: string }>; total: number }>(
                'kb_list_documents',
                {}
              )
            ).total
          ).toBe(1)
          const selection = new EmbeddingModelService({
            settingsStore: runtime.storageService.embeddingSettings,
            documentsStore: runtime.documentsStore,
            indexJobStore: runtime.storageService.workspaceIndexJob,
            embeddingService: runtime.embeddingService,
            createLocalExecutor: () =>
              new TransformersEmbeddingExecutor({
                modelsPath,
                modelName: DEFAULT_EMBEDDING_MODEL_NAME
              })
          })
          try {
            await selection.initialize()
            const remote = await selection.saveRemote({
              name: 'Unavailable endpoint',
              baseUrl: 'https://embedding-contract.invalid/v1',
              modelName: 'embedding',
              apiKey: 'reserved-domain-test-key'
            })
            const selected = await selection.select(remote.remoteModels[0].id)
            expect(selected.index).toMatchObject({
              staleFileCount: 0,
              staleWebCount: 1,
              restoreModelId: LOCAL_EMBEDDING_MODEL_ID,
              running: false
            })
            for (const strategy of ['keyword', 'semantic', 'auto']) {
              await expect(
                harness.invoke('kb_search', {
                  queryText: '全局网页',
                  strategy,
                  documentIds: ['missing-document']
                })
              ).rejects.toThrow('indexes do not match')
            }
            await expect(harness.invoke('kb_list_documents', {})).rejects.toThrow(
              'indexes do not match'
            )
            // Reopening configures the executor without requesting embeddings from the reserved endpoint.
            await selection.initialize()
            expect((await selection.getSnapshot()).index.staleWebCount).toBe(1)
            await selection.select(LOCAL_EMBEDDING_MODEL_ID)
            expect((await selection.getSnapshot()).index).toMatchObject({
              staleFileCount: 0,
              staleWebCount: 0
            })
            expect((await harness.invoke<{ total: number }>('kb_list_documents', {})).total).toBe(1)
          } finally {
            await selection.close()
          }
          runtime.assertThat(true, {
            name: 'kb-availability-boundaries',
            message:
              '模型不可用或索引身份失效时全部 KB 工具报错；选择和启动不重建，切回匹配模型后恢复。'
          })
        }
      })
    })
  })
})
