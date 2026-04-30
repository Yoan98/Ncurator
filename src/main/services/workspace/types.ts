import type { WorkspaceNode, WorkspaceSource } from '../../../shared/types'

export type WorkspaceValidationResult = {
  normalizedRootPath: string
  displayName: string
}

export type WorkspaceScanResult = {
  workspace: WorkspaceSource
  nodes: WorkspaceNode[]
}

export type WorkspaceNodeDiff = {
  added: WorkspaceNode[]
  removed: WorkspaceNode[]
  changed: WorkspaceNode[]
  unchanged: WorkspaceNode[]
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

export type WorkspaceKnowledgeIndexedChunk = WorkspaceKnowledgeChunkSnapshot & {
  id: string
}

export type WorkspaceKnowledgeIndexResult = {
  documentId: string
  filePath: string
  fileExt: string
  documentName: string
  contentHash: string
  chunkCount: number
  usedCachedSplit: boolean
  usedCachedVectors: boolean
  chunks: WorkspaceKnowledgeIndexedChunk[]
}
