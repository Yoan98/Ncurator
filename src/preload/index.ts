import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AiRunEvent,
  SearchSourceFilter
} from '../shared/types'
import type { DesktopApi } from './api'

// Custom APIs for renderer
const api: DesktopApi = {
  ingestWeb: (payload): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-web', payload),
  ingestWebs: (payload): Promise<{ success: boolean; created?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-webs', payload),
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-external', url),
  openPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-path', filePath),
  revealPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('reveal-path', filePath),
  search: (
    query: string,
    sourceType?: SearchSourceFilter,
    documentIds?: string[]
  ) =>
    ipcRenderer.invoke('search', query, sourceType, documentIds),
  ftsSearch: (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) =>
    ipcRenderer.invoke('fts-search', query, sourceType, documentIds),
  vectorSearch: (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) =>
    ipcRenderer.invoke('vector-search', query, sourceType, documentIds),
  hybridSearch: (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) =>
    ipcRenderer.invoke('hybrid-search', query, sourceType, documentIds),
  listDocuments: (payload) => ipcRenderer.invoke('list-documents', payload),
  workspaceList: () => ipcRenderer.invoke('workspace-list'),
  workspaceCreate: (payload) => ipcRenderer.invoke('workspace-create', payload),
  workspaceDelete: (workspaceId: string) => ipcRenderer.invoke('workspace-delete', workspaceId),
  workspaceNodes: (payload) => ipcRenderer.invoke('workspace-nodes', payload),
  workspaceScan: (payload) => ipcRenderer.invoke('workspace-scan', payload),
  workspacePrepare: (payload) => ipcRenderer.invoke('workspace-prepare', payload),
  sourceScopeList: (payload) => ipcRenderer.invoke('source-scope-list', payload),
  webSourceList: () => ipcRenderer.invoke('web-source-list'),
  webSourceRefresh: (payload) => ipcRenderer.invoke('web-source-refresh', payload),
  webSourceDelete: (webSourceId: string) => ipcRenderer.invoke('web-source-delete', webSourceId),
  legacyLocalImportMigrationStatus: () => ipcRenderer.invoke('legacy-local-import-migration-status'),
  listChunks: (payload) => ipcRenderer.invoke('list-chunks', payload),
  deleteDocuments: (
    ids: string[]
  ): Promise<{ success: boolean; deletedDocs?: number; deletedChunks?: number; error?: string }> =>
    ipcRenderer.invoke('delete-documents', ids),
  dropDocumentsTable: (): Promise<{ success: boolean; existed?: boolean; error?: string }> =>
    ipcRenderer.invoke('drop-documents-table'),
  sourceListRefresh: (cb: () => void) => ipcRenderer.on('source-list-refresh', () => cb()),
  removeSourceListRefreshListeners: () => ipcRenderer.removeAllListeners('source-list-refresh'),
  downloadModel: (repoId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('download-model', repoId),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_event, data) => cb(data)),
  removeDownloadProgressListeners: () => ipcRenderer.removeAllListeners('download-progress'),
  getModels: () => ipcRenderer.invoke('get-models'),
  getEmbeddingStatus: () => ipcRenderer.invoke('get-embedding-status'),
  readFile: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('read-file', filePath),

  // Chat & LLM
  chatSessionList: () => ipcRenderer.invoke('chat-session-list'),
  chatSessionSave: (session) =>
    ipcRenderer.invoke('chat-session-save', session),
  chatSessionDelete: (id: string) =>
    ipcRenderer.invoke('chat-session-delete', id),
  chatMessageList: (sessionId: string) =>
    ipcRenderer.invoke('chat-message-list', sessionId),
  chatMessageSave: (message) =>
    ipcRenderer.invoke('chat-message-save', message),
  llmConfigList: () => ipcRenderer.invoke('llm-config-list'),
  llmConfigSave: (config) =>
    ipcRenderer.invoke('llm-config-save', config),
  llmConfigDelete: (id: string) =>
    ipcRenderer.invoke('llm-config-delete', id),
  llmConfigSetActive: (id: string) =>
    ipcRenderer.invoke('llm-config-set-active', id),

  aiRunStart: (payload) =>
    ipcRenderer.invoke('ai-run-start', payload),
  aiRunCancel: (runId: string) => ipcRenderer.invoke('ai-run-cancel', runId),
  aiRunApprovalDecide: (payload) => ipcRenderer.invoke('ai-run-approval-decide', payload),
  draftReviewList: (payload) => ipcRenderer.invoke('draft-review-list', payload),
  draftReviewGet: (payload) => ipcRenderer.invoke('draft-review-get', payload),
  draftReviewSetDecision: (payload) => ipcRenderer.invoke('draft-review-set-decision', payload),
  draftReviewValidate: (payload) => ipcRenderer.invoke('draft-review-validate', payload),
  draftReviewCommit: (payload) => ipcRenderer.invoke('draft-review-commit', payload),
  onAiRunEvent: (cb: (event: AiRunEvent) => void) =>
    ipcRenderer.on('ai-run-event', (_event, data) => cb(data)),
  removeAiRunEventListeners: () => ipcRenderer.removeAllListeners('ai-run-event')
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
