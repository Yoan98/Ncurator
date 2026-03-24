import { test } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createWorkspaceIpcTestContext } from '../utils/workspaceIpcTestContext'

test('workspace-ipc-web-source-refresh-and-delete', async () => {
  await runBackendCase({
    caseId: 'workspace-ipc-web-source-refresh-and-delete',
    caseType: 'scenario',
    domain: 'workspace',
    layer: 'backend',
    suite: 'ipc',
    groups: ['scenario'],
    description:
      'workspace ipc should hydrate web sources from persisted web documents, refresh them, and delete them cleanly.',
    fixtures: [],
    runMode: 'repeatable',
    execute: async (runtime) => {
      const context = await createWorkspaceIpcTestContext({
        userDataRoot: runtime.workspaceRoot
      })

      await context.documentsStore.addDocument({
        id: 'web-doc-1',
        name: 'https://example.com/policy',
        source_type: 'web',
        file_path: 'https://example.com/policy',
        created_at: 1,
        import_status: 2,
        source_url: 'https://example.com/policy',
        source_title: 'Policy Page',
        normalized_source_url: 'https://example.com/policy',
        fetched_at: 1
      })

      const listAfterHydration = await context.webSourceList()
      const hydratedSource = listAfterHydration.items[0]
      if (!hydratedSource) {
        throw new Error('hydrated web source should exist')
      }

      const refreshResponse = await context.webSourceRefresh({
        webSourceId: hydratedSource.id
      })
      const listAfterRefresh = await context.webSourceList()
      const deleteResponse = await context.webSourceDelete(hydratedSource.id)
      const listAfterDelete = await context.webSourceList()
      const documentAfterDelete = await context.documentsStore.getDocumentById('web-doc-1')

      return {
        listAfterHydration,
        refreshResponse,
        listAfterRefresh,
        deleteResponse,
        listAfterDelete,
        documentAfterDelete,
        senderMessages: context.senderMessages
      }
    },
    assert: async (result, runtime) => {
      runtime.assertThat(
        result.listAfterHydration.total === 1 &&
          result.listAfterHydration.items[0]?.normalized_url === 'https://example.com/policy',
        {
          name: 'workspace-ipc-web-source-hydration',
          message: 'web-source-list should hydrate persisted web documents into visible web source records',
          data: result.listAfterHydration
        }
      )

      runtime.assertThat(
        result.refreshResponse.success === true &&
          result.refreshResponse.source?.import_status === 2 &&
          typeof result.refreshResponse.source?.fetched_at === 'number',
        {
          name: 'workspace-ipc-web-source-refresh',
          message: 'web-source-refresh should update the source status and fetched timestamp after reprocessing',
          data: result.refreshResponse
        }
      )

      runtime.assertThat(
        result.deleteResponse.success === true &&
          result.listAfterDelete.total === 0 &&
          result.documentAfterDelete === null,
        {
          name: 'workspace-ipc-web-source-delete',
          message: 'web-source-delete should remove the source record and detach the underlying document from persistence',
          data: {
            deleteResponse: result.deleteResponse,
            listAfterDelete: result.listAfterDelete,
            senderMessages: result.senderMessages,
            workspaceRoot: runtime.workspaceRoot
          }
        }
      )
    }
  })
})
