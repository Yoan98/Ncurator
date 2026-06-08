import { AiFileChangeStore } from './domains/AiFileChangeStore'
import { AiRuntimeSettingsStore } from './domains/AiRuntimeSettingsStore'
import { LanceDbCore } from './core/LanceDbCore'
import { ChatStore } from './domains/ChatStore'
import { DocxApplyStore } from './domains/DocxApplyStore'
import { DocumentsStore } from './domains/DocumentsStore'
import { LlmConfigStore } from './domains/LlmConfigStore'
import { WebSourceStore } from './domains/WebSourceStore'
import { WorkspaceIndexJobStore } from './domains/WorkspaceIndexJobStore'
import { WorkspaceStore } from './domains/WorkspaceStore'
import { LegacyLocalImportMigration } from './migrations/LegacyLocalImportMigration'
import type { LegacyLocalImportMigrationStatus } from '../../../shared/types'

export class StorageService {
  private static instance: StorageService

  public readonly core: LanceDbCore
  public readonly documents: DocumentsStore
  public readonly webSource: WebSourceStore
  public readonly chat: ChatStore
  public readonly aiFileChange: AiFileChangeStore
  public readonly docxApply: DocxApplyStore
  public readonly llm: LlmConfigStore
  public readonly aiRuntimeSettings: AiRuntimeSettingsStore
  public readonly workspace: WorkspaceStore
  public readonly workspaceIndexJob: WorkspaceIndexJobStore
  private legacyLocalImportMigrationStatus: LegacyLocalImportMigrationStatus | null = null

  public constructor(input: { dbPath?: string } = {}) {
    this.core = new LanceDbCore(input.dbPath)
    this.documents = new DocumentsStore(this.core)
    this.webSource = new WebSourceStore(this.core)
    this.chat = new ChatStore(this.core)
    this.aiFileChange = new AiFileChangeStore(this.core)
    this.docxApply = new DocxApplyStore(this.core)
    this.llm = new LlmConfigStore(this.core)
    this.aiRuntimeSettings = new AiRuntimeSettingsStore(this.core)
    this.workspace = new WorkspaceStore(this.core)
    this.workspaceIndexJob = new WorkspaceIndexJobStore(this.core)
  }

  public static getInstance(): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService()
    }
    return StorageService.instance
  }

  public async initialize(): Promise<void> {
    await this.core.initialize()
    await this.failInterruptedWorkspaceIndexJobs()
    const migration = new LegacyLocalImportMigration(this.documents, this.workspace)
    this.legacyLocalImportMigrationStatus = await migration.run()
  }

  public async failInterruptedWorkspaceIndexJobs(
    message = '程序关闭导致索引中断'
  ): Promise<void> {
    const now = Date.now()
    await Promise.all([
      this.workspaceIndexJob.failRunningJobs(message, now),
      this.workspace.failIndexingFileRecords(message, now),
      this.webSource.failRunningSources(message, now)
    ])
  }

  public getLegacyLocalImportMigrationStatus(): LegacyLocalImportMigrationStatus | null {
    return this.legacyLocalImportMigrationStatus
  }

  public async close(): Promise<void> {
    await this.core.close()
  }
}
