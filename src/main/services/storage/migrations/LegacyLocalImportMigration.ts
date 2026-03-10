import type { LegacyLocalImportMigrationStatus } from '../../../../shared/types'

type MigrationDocumentsStore = {
  listLegacyLocalDocuments: (boundDocumentIds: string[]) => Promise<Array<{ id: string }>>
  countChunksByDocumentIds: (ids: string[]) => Promise<number>
  deleteDocumentsByIds: (ids: string[]) => Promise<{
    success: boolean
    error?: string
    deletedDocs?: number
    deletedChunks?: number
  }>
}

type MigrationWorkspaceStore = {
  listWorkspaceDocumentIds: () => Promise<string[]>
}

export class LegacyLocalImportMigration {
  public constructor(
    private readonly documentsStore: MigrationDocumentsStore,
    private readonly workspaceStore: MigrationWorkspaceStore
  ) {}

  public async run(): Promise<LegacyLocalImportMigrationStatus | null> {
    const boundDocumentIds = await this.workspaceStore.listWorkspaceDocumentIds()
    const legacyDocuments = await this.documentsStore.listLegacyLocalDocuments(boundDocumentIds)
    if (legacyDocuments.length === 0) {
      return null
    }

    const legacyDocumentIds = legacyDocuments.map((document) => document.id)
    const removedChunkCount = await this.documentsStore.countChunksByDocumentIds(legacyDocumentIds)
    const deletion = await this.documentsStore.deleteDocumentsByIds(legacyDocumentIds)
    if (!deletion.success) {
      throw new Error(deletion.error || '清理旧本地导入记录失败')
    }

    return {
      hasLegacyLocalImports: true,
      removedDocumentCount: deletion.deletedDocs || legacyDocumentIds.length,
      removedChunkCount: deletion.deletedChunks ?? removedChunkCount,
      migratedAt: Date.now()
    }
  }
}
