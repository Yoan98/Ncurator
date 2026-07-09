import type {
  WorkspaceFileIndexRecord,
  WorkspaceSource,
  WorkspaceTreeEntry
} from '../../../shared/types'

export type WorkspaceValidationResult = {
  normalizedRootPath: string
  displayName: string
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
  source_type: 'file'
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

export type WorkspaceKnowledgeIndexInput = {
  workspaceId: string
  documentId: string
  filePath: string
  documentName: string
  createdAt?: number
  cache?: WorkspaceKnowledgeCache
}

export type WorkspaceKnowledgePrepareWorkerInput = {
  workspaceId: string
  documentId: string
  filePath: string
  documentName: string
  cachedSplit?: WorkspaceKnowledgeSplitSnapshot | null
  cachedVectors?: WorkspaceKnowledgeVectorSnapshot | null
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

export type WorkspaceKnowledgePrepareWorkerResult = Omit<
  WorkspaceKnowledgeIndexResult,
  'usedCachedSplit' | 'usedCachedVectors' | 'chunks'
> & {
  splitSnapshot: WorkspaceKnowledgeSplitSnapshot
  vectorSnapshot: WorkspaceKnowledgeVectorSnapshot
  chunks: WorkspaceKnowledgeChunkInput[]
}

export type WorkspaceIndexWorkerRequest = {
  requestId: string
  action: 'prepare_file'
  payload: WorkspaceKnowledgePrepareWorkerInput
}

export type WorkspaceIndexWorkerResponse = {
  requestId: string
  ok: boolean
  payload?: WorkspaceKnowledgePrepareWorkerResult
  error?: string
}

export type WorkspaceIndexWorkerPendingRequest = {
  resolve: (response: WorkspaceIndexWorkerResponse) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

export type WorkspaceIndexWorkerRequestHandler = (
  request: WorkspaceIndexWorkerRequest
) => Promise<WorkspaceIndexWorkerResponse>

export type WorkspaceIndexWorkerClientOptions = {
  workerUrl?: URL
  fallbackHandler?: WorkspaceIndexWorkerRequestHandler
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
