import type {
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../shared/types'

export type WorkspaceValidationResult = {
  normalizedRootPath: string
  displayName: string
  kind: 'file' | 'directory'
}

export type WorkspaceKnowledgeChunkSnapshot = {
  text: string
  page: number
}

export type WorkspaceKnowledgeSplitSnapshot = {
  contentHash: string
  fileExt: string
  chunks: WorkspaceKnowledgeChunkSnapshot[]
}

export type WorkspaceKnowledgeVectorSnapshot = {
  contentHash: string
  fileExt: string
  modelName: string
  vectors: number[][]
}

export type WorkspaceKnowledgeVectorBatchInput = {
  chunks: WorkspaceKnowledgeChunkSnapshot[]
}

export type WorkspaceKnowledgeVectorBuildResult = {
  vectors: number[][]
}

export type WorkspaceKnowledgeChunkInput = {
  id: string
  text: string
  document_id: string
  workspace_id: string
  document_name: string
  source_type: 'file' | 'web'
  metadata: { page: number }
}

export type WorkspaceKnowledgeCache = {
  loadSplitSnapshot: (input: {
    contentHash: string
    fileExt: string
  }) => Promise<WorkspaceKnowledgeSplitSnapshot | null>
  saveSplitSnapshot: (snapshot: WorkspaceKnowledgeSplitSnapshot) => Promise<void>
  loadVectorSnapshot: (input: {
    contentHash: string
    fileExt: string
    modelName: string
  }) => Promise<WorkspaceKnowledgeVectorSnapshot | null>
  saveVectorSnapshot: (snapshot: WorkspaceKnowledgeVectorSnapshot) => Promise<void>
}

/** 网页正文源：已抓好的文本，无本地文件路径 */
export type WorkspaceKnowledgeWebInput = {
  sourceType: 'web'
  workspaceId: string
  documentId: string
  documentName: string
  sourceUrl: string
  rawText: string
  contentHash: string
  createdAt?: number
  cache?: WorkspaceKnowledgeCache
  signal?: AbortSignal
}

export type WorkspaceKnowledgeIndexInput = {
  workspaceId: string
  documentId: string
  filePath: string
  documentName: string
  createdAt?: number
  cache?: WorkspaceKnowledgeCache
  signal?: AbortSignal
}

/** 文件解析 worker 入参：只负责读取和切分，不负责向量推理 */
export type WorkspacePrepareWorkerInput =
  | {
      sourceType?: 'file'
      filePath: string
      cachedSplit?: WorkspaceKnowledgeSplitSnapshot | null
    }
  | {
      sourceType: 'web'
      documentName: string
      sourceUrl: string
      rawText: string
      contentHash: string
      cachedSplit?: WorkspaceKnowledgeSplitSnapshot | null
    }

export type WorkspaceKnowledgeIndexedChunk = WorkspaceKnowledgeChunkSnapshot & {
  id: string
}

export type WorkspaceKnowledgeIndexResult = {
  documentId: string
  filePath: string
  fileExt: string
  documentName: string
  generationId?: string
  contentHash: string
  chunkCount: number
  usedCachedSplit: boolean
  usedCachedVectors: boolean
  chunks: WorkspaceKnowledgeIndexedChunk[]
}

export type WorkspaceKnowledgePreparedDocument = Omit<
  WorkspaceKnowledgeIndexResult,
  'usedCachedSplit' | 'usedCachedVectors' | 'chunks'
> & {
  splitSnapshot: WorkspaceKnowledgeSplitSnapshot
  vectorSnapshot: WorkspaceKnowledgeVectorSnapshot
  chunks: WorkspaceKnowledgeChunkInput[]
}

export type WorkspacePreparedSource = {
  filePath: string
  fileExt: string
  contentHash: string
  sourceType: 'file' | 'web'
  splitSnapshot: WorkspaceKnowledgeSplitSnapshot
}

export type WorkspacePrepareWorkerRequest = {
  requestId: string
  action: 'prepare_source'
  payload: WorkspacePrepareWorkerInput
}

export type WorkspacePrepareWorkerResponse = {
  requestId: string
  action: 'prepare_source'
  ok: boolean
  payload?: WorkspacePreparedSource
  error?: string
}

export type WorkspacePrepareWorkerPendingRequest = {
  resolve: (response: WorkspacePrepareWorkerResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type WorkspacePrepareWorkerClientOptions = {
  workerUrl?: URL
  errorLogService?: {
    write: (entry: {
      module: string
      error: Error | string
      context?: Record<string, boolean | number | string | undefined>
    }) => void
  }
}

export type WorkspaceTreeScanResult = {
  workspace: WorkspaceSource
  entries: WorkspaceTreeEntry[]
}

export type WorkspaceTreeEntryDiff = {
  added: WorkspaceTreeEntry[]
  removed: WorkspaceFileIndexRecord[]
  changed: Array<{
    entry: WorkspaceTreeEntry
    record: WorkspaceFileIndexRecord
  }>
  unchanged: Array<{
    entry: WorkspaceTreeEntry
    record: WorkspaceFileIndexRecord
  }>
  untracked: WorkspaceTreeEntry[]
}
