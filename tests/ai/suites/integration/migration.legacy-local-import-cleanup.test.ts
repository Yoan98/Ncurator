import { describe, test } from 'vitest'
import { LegacyLocalImportMigration } from '../../../../src/main/services/storage/migrations/LegacyLocalImportMigration'
import { recordAssertion } from '../../harness/assertions'
import { runIntegrationCase } from '../../harness/capabilityCase'

describe('integration/migration', () => {
  test('legacy local import migration should only delete unbound file documents', async () => {
    await runIntegrationCase({
      caseId: 'migration-legacy-local-import-cleanup',
      description: '验证旧本地导入迁移仅清理未绑定工作空间的 file documents，并保留网页资料与新模型文档。',
      expectedOutcome: 'success',
      scenarioTags: ['migration', 'legacy-local-import', 'cleanup'],
      requiredFixtures: [],
      fixtureCopies: [],
      buildExecutionOutcome: () => ({
        status: 'completed',
        resultCode: 'ok',
        summary: 'legacy local import migration completed'
      }),
      execute: async () => {
        const deletedDocumentBatches: string[][] = []
        const migration = new LegacyLocalImportMigration(
          {
            listLegacyLocalDocuments: async (boundDocumentIds) => {
              if (boundDocumentIds.length !== 2) {
                throw new Error(`unexpected bound ids: ${boundDocumentIds.join(',')}`)
              }
              return [{ id: 'legacy-file-1' }, { id: 'legacy-file-2' }]
            },
            countChunksByDocumentIds: async (ids) => {
              if (ids.length !== 2) throw new Error(`unexpected ids: ${ids.join(',')}`)
              return 7
            },
            deleteDocumentsByIds: async (ids) => {
              deletedDocumentBatches.push(ids)
              return {
                success: true,
                deletedDocs: ids.length,
                deletedChunks: 7
              }
            }
          },
          {
            listWorkspaceDocumentIds: async () => ['workspace-doc-1', 'workspace-doc-2']
          }
        )

        const summary = await migration.run()
        const emptySummary = await new LegacyLocalImportMigration(
          {
            listLegacyLocalDocuments: async () => [],
            countChunksByDocumentIds: async () => 0,
            deleteDocumentsByIds: async () => ({
              success: true,
              deletedDocs: 0,
              deletedChunks: 0
            })
          },
          {
            listWorkspaceDocumentIds: async () => ['workspace-doc-1']
          }
        ).run()

        return {
          summary,
          emptySummary,
          deletedDocumentBatches
        }
      },
      assert: async (result, runtime) => {
        recordAssertion(runtime.assertions, {
          id: 'migration.deletes-unbound-local-documents',
          pass:
            result.summary?.hasLegacyLocalImports === true &&
            result.summary.removedDocumentCount === 2 &&
            result.summary.removedChunkCount === 7,
          details: JSON.stringify(result.summary)
        })
        recordAssertion(runtime.assertions, {
          id: 'migration.passes-only-legacy-document-ids',
          pass:
            result.deletedDocumentBatches.length === 1 &&
            result.deletedDocumentBatches[0].join(',') === 'legacy-file-1,legacy-file-2',
          details: JSON.stringify(result.deletedDocumentBatches)
        })
        recordAssertion(runtime.assertions, {
          id: 'migration.noop-when-no-legacy-documents',
          pass: result.emptySummary === null,
          details: JSON.stringify(result.emptySummary)
        })
      }
    })
  })
})
