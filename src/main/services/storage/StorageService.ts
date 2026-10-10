import path from 'node:path'
import { AiFileChangeStore } from './domains/AiFileChangeStore'
import { AiRunStore } from './domains/AiRunStore'
import { AppSettingsStore } from './domains/AppSettingsStore'
import { LanceDbCore } from './core/LanceDbCore'
import { SqliteCore } from './sqlite/SqliteCore'
import { PartnerStore } from './domains/PartnerStore'
import { DocxApplyStore } from './domains/DocxApplyStore'
import { DocumentsStore } from './domains/DocumentsStore'
import { LlmConfigStore } from './domains/LlmConfigStore'
import { WebSourceStore } from './domains/WebSourceStore'
import { WorkspaceIndexJobStore } from './domains/WorkspaceIndexJobStore'
import { WorkspaceStore } from './domains/WorkspaceStore'
import { WorkbenchUiStore } from './domains/WorkbenchUiStore'
import { BrowserTabStateStore } from './domains/BrowserTabStateStore'
import { ScheduledTaskStore } from './domains/ScheduledTaskStore'
import { AiSubagentStore } from './domains/AiSubagentStore'
import { ChatMessageLogStore } from './domains/ChatMessageLogStore'
import type { AppErrorLogService } from '../logging/AppErrorLogService'

export class StorageService {
  private static instance: StorageService

  public readonly sqlite: SqliteCore
  public readonly vector: LanceDbCore
  public readonly documents: DocumentsStore
  public readonly webSource: WebSourceStore
  public readonly partner: PartnerStore
  public readonly aiFileChange: AiFileChangeStore
  public readonly aiRun: AiRunStore
  public readonly docxApply: DocxApplyStore
  public readonly llm: LlmConfigStore
  public readonly appSettings: AppSettingsStore
  public readonly workspace: WorkspaceStore
  public readonly workspaceIndexJob: WorkspaceIndexJobStore
  public readonly workbenchUi: WorkbenchUiStore
  public readonly browserTabs: BrowserTabStateStore
  public readonly scheduledTask: ScheduledTaskStore
  public readonly subagent: AiSubagentStore
  public readonly chatMessageLog: ChatMessageLogStore

  public constructor(
    input: {
      dbPath?: string
      sqlitePath?: string
      vectorPath?: string
      errorLogService?: AppErrorLogService
    } = {}
  ) {
    const sqlitePath =
      input.sqlitePath ||
      (input.dbPath ? path.join(path.dirname(input.dbPath), 'app.sqlite') : undefined)
    this.sqlite = new SqliteCore(sqlitePath)
    this.vector = new LanceDbCore(input.vectorPath || input.dbPath, input.errorLogService)
    this.documents = new DocumentsStore(this.sqlite, this.vector)
    this.webSource = new WebSourceStore(this.sqlite)
    this.partner = new PartnerStore(this.sqlite)
    this.aiFileChange = new AiFileChangeStore(this.sqlite)
    this.aiRun = new AiRunStore(this.sqlite)
    this.docxApply = new DocxApplyStore(this.sqlite)
    this.llm = new LlmConfigStore(this.sqlite)
    this.appSettings = new AppSettingsStore(this.sqlite)
    this.workspace = new WorkspaceStore(this.sqlite)
    this.workspaceIndexJob = new WorkspaceIndexJobStore(this.sqlite)
    this.workbenchUi = new WorkbenchUiStore(this.sqlite)
    this.browserTabs = new BrowserTabStateStore(this.sqlite)
    this.scheduledTask = new ScheduledTaskStore(this.sqlite)
    this.subagent = new AiSubagentStore(this.sqlite)
    this.chatMessageLog = new ChatMessageLogStore(this.sqlite)
  }

  public static getInstance(input: { errorLogService?: AppErrorLogService } = {}): StorageService {
    if (!StorageService.instance) {
      StorageService.instance = new StorageService(input)
    }
    return StorageService.instance
  }

  public async initialize(): Promise<void> {
    this.sqlite.initialize()
    this.subagent.interruptActive()
    await this.sqlite.runPendingAfterCommitHooks({ lanceDbPath: this.vector.getDbPath() })
    await this.vector.initialize()
    await this.failInterruptedWorkspaceIndexJobs()
    await this.documents.purgeStaleChunks()
  }

  public async failInterruptedWorkspaceIndexJobs(message = '程序关闭导致索引中断'): Promise<void> {
    const now = Date.now()
    await Promise.all([
      this.workspaceIndexJob.failRunningJobs(message, now),
      this.workspace.failIndexingFileRecords(message, now),
      this.webSource.failRunningSources(message, now)
    ])
  }

  public async close(): Promise<void> {
    await this.vector.close()
    this.sqlite.close()
  }
}
