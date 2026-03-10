import * as arrow from 'apache-arrow'
import {
  DocumentRecord,
  DocumentImportStatus,
  WebSourceIdentityKind,
  WebSourceRecord,
  WorkspaceSource,
  WorkspaceNode,
  WorkspaceSourceStatus,
  WorkspaceNodeKind,
  WorkspacePrepareStatus,
  WorkspacePrepareMode,
  WorkspaceRuntimeBinding,
  SourceScopeSelection,
  WorkspaceSyncProgress,
  WorkspaceListResponse,
  WorkspaceNodeListResponse,
  SourceScopeListResponse,
  WebSourceListResponse,
  LegacyLocalImportMigrationStatus,
  CreateWorkspaceSourceRequest,
  UpdateWorkspaceSourceRequest,
  WorkspaceMutationResponse,
  DeleteWorkspaceSourceResponse,
  ListWorkspaceNodesRequest,
  ScanWorkspaceRequest,
  PrepareWorkspaceRequest,
  WorkspaceJobResponse,
  RefreshWebSourceRequest,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  ListSourceScopesRequest,
  SearchResult,
  DocumentListItem,
  DocumentListResponse,
  ChunkListItem,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  LLMConfig,
  AiRunEvent,
  AiPlanTask,
  AiRunStatus,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalDecisionRequest,
  AiRunApprovalDecisionResponse,
  JsonObject,
  JsonValue,
  ChatSessionMemory,
  ChatSessionMemoryRow
} from '../../shared/types'

export type {
  DocumentRecord,
  DocumentImportStatus,
  WebSourceIdentityKind,
  WebSourceRecord,
  WorkspaceSource,
  WorkspaceNode,
  WorkspaceSourceStatus,
  WorkspaceNodeKind,
  WorkspacePrepareStatus,
  WorkspacePrepareMode,
  WorkspaceRuntimeBinding,
  SourceScopeSelection,
  WorkspaceSyncProgress,
  WorkspaceListResponse,
  WorkspaceNodeListResponse,
  SourceScopeListResponse,
  WebSourceListResponse,
  LegacyLocalImportMigrationStatus,
  CreateWorkspaceSourceRequest,
  UpdateWorkspaceSourceRequest,
  WorkspaceMutationResponse,
  DeleteWorkspaceSourceResponse,
  ListWorkspaceNodesRequest,
  ScanWorkspaceRequest,
  PrepareWorkspaceRequest,
  WorkspaceJobResponse,
  RefreshWebSourceRequest,
  WebSourceMutationResponse,
  DeleteWebSourceResponse,
  ListSourceScopesRequest,
  SearchResult,
  DocumentListItem,
  DocumentListResponse,
  ChunkListItem,
  ChunkListResponse,
  ChatSession,
  ChatMessage,
  LLMConfig,
  AiRunEvent,
  AiPlanTask,
  AiRunStatus,
  AiRunStartRequest,
  AiRunStartResponse,
  AiRunCancelResponse,
  AiRunApprovalDecisionRequest,
  AiRunApprovalDecisionResponse,
  JsonObject,
  JsonValue,
  ChatSessionMemory,
  ChatSessionMemoryRow
}

/**
 * LanceDB Table Configuration
 */
export interface TableConfig {
  name: string
  schema: arrow.Schema
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
  document_name: string
  source_type: string
  metadata: {
    page: number
  }
}
