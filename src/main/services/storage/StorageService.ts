import { LanceDbCore } from './core/LanceDbCore'
import { ChatStore } from './domains/ChatStore'
import { DraftReviewStore } from './domains/DraftReviewStore'
import { DocumentsStore } from './domains/DocumentsStore'
import { LlmConfigStore } from './domains/LlmConfigStore'
import { WebSourceStore } from './domains/WebSourceStore'
import { WorkspaceStore } from './domains/WorkspaceStore'
import { LegacyLocalImportMigration } from './migrations/LegacyLocalImportMigration'
import type { LegacyLocalImportMigrationStatus } from '../../../shared/types'

export class StorageService {
  private static instance: StorageService

  public readonly core: LanceDbCore
  public readonly documents: DocumentsStore
  public readonly webSource: WebSourceStore
  public readonly chat: ChatStore
  public readonly draftReview: DraftReviewStore
  public readonly llm: LlmConfigStore
  public readonly workspace: WorkspaceStore
  private legacyLocalImportMigrationStatus: LegacyLocalImportMigrationStatus | null = null

  private constructor() {
    this.core = new LanceDbCore()
    this.documents = new DocumentsStore(this.core)
    this.webSource = new WebSourceStore(this.core)
    this.chat = new ChatStore(this.core)
    this.draftReview = new DraftReviewStore(this.core)
    this.llm = new LlmConfigStore(this.core)
    this.workspace = new WorkspaceStore(this.core)
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService()
    }
    return StorageService.instance
  }

  public async initialize(): Promise<void> {
    await this.core.initialize()
    const migration = new LegacyLocalImportMigration(this.documents, this.workspace)
    this.legacyLocalImportMigrationStatus = await migration.run()
  }

  public getLegacyLocalImportMigrationStatus(): LegacyLocalImportMigrationStatus | null {
    return this.legacyLocalImportMigrationStatus
  }

  public async close(): Promise<void> {
    await this.core.close()
  }
}
