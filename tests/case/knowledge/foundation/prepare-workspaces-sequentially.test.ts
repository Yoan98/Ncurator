import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { WorkspaceKnowledgePrepareService } from '../../../../src/main/services/workspace/WorkspaceKnowledgePrepareService'
import { prepareWorkspaceSource } from '../../../../src/main/services/workspace/worker/workspacePrepareWorker'
import { prepareWorkspacesSequentially } from '../../../../src/shared/prepareWorkspacesSequentially'
import { runBackendCase } from '../../../harness/backend/run-backend-case'

describe('knowledge foundation', () => {
  it('prepare-workspaces-sequentially', async () => {
    await runBackendCase({
      caseId: 'prepare-workspaces-sequentially',
      harnessMode: 'tool-real',
      domain: 'knowledge',
      suite: 'foundation',
      description: '多地址更新索引按顺序等待前一个完成再启动下一个。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await runtime.prepareEmbeddingModel()
        const prepareService = new WorkspaceKnowledgePrepareService({
          embeddingService: runtime.embeddingService,
          documentsStore: runtime.documentsStore,
          prepareSource: prepareWorkspaceSource
        })
        const workspaceIds = ['ws-a', 'ws-b', 'ws-c']
        const now = Date.now()
        for (const workspaceId of workspaceIds) {
          const rootPath = path.join(runtime.workspaceRoot, workspaceId)
          await mkdir(rootPath, { recursive: true })
          await writeFile(path.join(rootPath, 'note.txt'), `${workspaceId} sequential index\n`)
          await runtime.storageService.workspace.saveWorkspace({
            id: workspaceId,
            root_path: rootPath,
            created_at: now,
            updated_at: now
          })
        }

        const events: string[] = []
        const results = await prepareWorkspacesSequentially(workspaceIds, async (workspaceId) => {
          events.push(`start:${workspaceId}`)
          const indexed = await prepareService.indexLocalFile({
            workspaceId,
            documentId: `${workspaceId}-doc`,
            filePath: path.join(runtime.workspaceRoot, workspaceId, 'note.txt'),
            documentName: 'note.txt'
          })
          events.push(`end:${workspaceId}`)
          return indexed.documentId
        })
        const cancelCalls: string[] = []
        await prepareWorkspacesSequentially(
          workspaceIds,
          async (workspaceId) => {
            cancelCalls.push(workspaceId)
            return { cancelled: workspaceId === 'ws-a' }
          },
          (result) => !result.cancelled
        )
        return { results, events, cancelCalls }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.results.join(',') === 'ws-a-doc,ws-b-doc,ws-c-doc' &&
            result.events.join(',') ===
              'start:ws-a,end:ws-a,start:ws-b,end:ws-b,start:ws-c,end:ws-c',
          {
            name: 'prepare-is-sequential',
            message: '多地址更新索引必须等前一个完成后再启动下一个，对齐 SET-WORKSPACE-004-AC11。',
            data: result
          }
        )
        runtime.assertThat(result.cancelCalls.join(',') === 'ws-a', {
          name: 'prepare-stops-after-cancelled',
          message: '首个地址 cancelled 后不得再启动后续地址，对齐 SET-WORKSPACE-004-AC15。',
          data: result
        })
      }
    })
  })
})
