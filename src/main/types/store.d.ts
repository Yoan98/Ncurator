import * as arrow from 'apache-arrow'
import {
  DocumentRecord,
  DocumentImportStatus,
  WebSourceIdentityKind,
  WebSourceRecord,
  WorkspaceSource,
  WorkspaceNode,
  WorkspaceFileIndexRecord,
  WorkspaceTreeEntry,
  WorkspaceFileSummary,
  WorkspaceSourceStatus,
  WorkspaceNodeKind,
  WorkspacePrepareStatus,
  WorkspaceFileIndexStatus,
  WorkspacePrepareMode,
  WorkspaceRuntimeBinding,
  SelectedReference,
  WorkspaceSyncProgress,
  WorkspaceListResponse,
  WorkspaceNodeListResponse,
  WorkspaceTreeListResponse,
  ReferenceItemListResponse,
  WebSourceListResponse,
  LegacyLocalImportMigrationStatus,
  CreateWorkspaceSourceRequest,
  UpdateWorkspaceSourceRequest,
  WorkspaceMutationResponse,
  PickDirectoryResponse,
  DeleteWorkspaceSourceResponse,
  ListWorkspaceNodesRequest,
  ListWorkspaceTreeRequest,
  ScanWorkspaceRequest,
  PrepareWorkspaceRequest,
  SyncWorkspaceIndexRequest,
  WorkspaceJobResponse,
  ListWebSourcesRequest,
  RefreshWebSourceRequest,
  DeleteWebSourceRequest,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  ListReferenceItemsRequest,
  SearchResult,
  DocumentListItem,
  DocumentListResponse,
  ChunkListItem,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  LLMConfig,
  LlmRuntimeConfig,
  LlmRemoteModel,
  LlmModelListResponse,
  RuntimeChangedFile,
  RuntimeArtifactsSummary,
  PickApplicationResponse,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
  AiRuntimeSettings,
  AiArtifactRef,
  AiFileArtifactRef,
  AiRunEvent,
  AiRunStatus,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  JsonObject,
  JsonValue,
  ChatConversationMemory,
  ChatConversationMemoryRow,
  ChatSessionResumeSnapshot,
  DocxApplyRecord,
  DocxApplyStatus,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  RevertDocxApplyRequest,
  RevertDocxApplyResponse,
  ChatSessionResumeSnapshotRow
} from '../../shared/types'

export type {
  DocumentRecord,
  DocumentImportStatus,
  WebSourceIdentityKind,
  WebSourceRecord,
  WorkspaceSource,
  WorkspaceNode,
  WorkspaceFileIndexRecord,
  WorkspaceTreeEntry,
  WorkspaceFileSummary,
  WorkspaceSourceStatus,
  WorkspaceNodeKind,
  WorkspacePrepareStatus,
  WorkspaceFileIndexStatus,
  WorkspacePrepareMode,
  WorkspaceRuntimeBinding,
  SelectedReference,
  WorkspaceSyncProgress,
  WorkspaceListResponse,
  WorkspaceNodeListResponse,
  WorkspaceTreeListResponse,
  ReferenceItemListResponse,
  WebSourceListResponse,
  LegacyLocalImportMigrationStatus,
  CreateWorkspaceSourceRequest,
  UpdateWorkspaceSourceRequest,
  WorkspaceMutationResponse,
  PickDirectoryResponse,
  DeleteWorkspaceSourceResponse,
  ListWorkspaceNodesRequest,
  ListWorkspaceTreeRequest,
  ScanWorkspaceRequest,
  PrepareWorkspaceRequest,
  SyncWorkspaceIndexRequest,
  WorkspaceJobResponse,
  ListWebSourcesRequest,
  RefreshWebSourceRequest,
  DeleteWebSourceRequest,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  ListReferenceItemsRequest,
  SearchResult,
  DocumentListItem,
  DocumentListResponse,
  ChunkListItem,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  LLMConfig,
  LlmRuntimeConfig,
  LlmRemoteModel,
  LlmModelListResponse,
  RuntimeChangedFile,
  RuntimeArtifactsSummary,
  PickApplicationResponse,
  OpenPathWithApplicationRequest,
  OpenPathWithApplicationResponse,
  AiRuntimeSettings,
  AiArtifactRef,
  AiFileArtifactRef,
  AiRunEvent,
  AiRunStatus,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalBatchDecisionRequest,
  AiRunApprovalBatchDecisionResponse,
  JsonObject,
  JsonValue,
  ChatConversationMemory,
  ChatConversationMemoryRow,
  ChatSessionResumeSnapshot,
  DocxApplyRecord,
  DocxApplyStatus,
  ListDocxApplyRecordsRequest,
  ListDocxApplyRecordsResponse,
  GetDocxApplyRecordRequest,
  GetDocxApplyRecordResponse,
  RevertDocxApplyRequest,
  RevertDocxApplyResponse,
  ChatSessionResumeSnapshotRow
}

/**
 * LanceDB Table Configuration
 */
export interface TableConfig {
  name: string
  schema: arrow.Schema
  recreateIfSchemaChanged?: boolean
  vectorIndexConfig?: {
    column: string
    options?: Record<string, unknown>
  }
  ftsIndexConfig?: {
    column: string
    options?: Record<string, unknown>
  }
}

/**
 * Document chunk input for indexing
 */
export interface ChunkInput {
  text: string
  id: string
  document_id: string
  workspace_id: string
  document_name: string
  source_type: string
  metadata: {
    page: number
  }
}
