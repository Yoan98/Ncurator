import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AiRunEvent,
  AppUpdateSnapshot,
  BrowserPanelState,
  JsonValue,
  SearchSourceFilter,
  WorkspaceIndexJobRecord
} from '../shared/types'
import {
  APP_UPDATE_CHECK_CHANNEL,
  APP_UPDATE_GET_SNAPSHOT_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_STATUS_CHANNEL
} from '../shared/constants'
import type { DesktopApi, DownloadProgress } from './api'

const isE2EFixtureMode = process.env.NCURATOR_E2E_MODE === '1'
const isE2EObserverEnabled = isE2EFixtureMode || process.env.NCURATOR_E2E_OBSERVER === '1'
const downloadProgressListeners = new Set<(progressData: DownloadProgress) => void>()
const workspaceIndexJobProgressListeners = new Set<(job: WorkspaceIndexJobRecord) => void>()

const emitE2EIpcCall = (name: string, payload?: JsonValue): void => {
  if (!isE2EObserverEnabled) return
  window.dispatchEvent(
    new CustomEvent('ncurator-e2e-ipc-call', {
      detail: {
        name,
        payload
      }
    })
  )
}

const emitE2EAiRunEvent = (event: AiRunEvent): void => {
  if (!isE2EObserverEnabled) return
  window.dispatchEvent(
    new CustomEvent<AiRunEvent>('ncurator-e2e-ai-run-event', {
      detail: event
    })
  )
}

const emitDownloadProgress = (payload: DownloadProgress): void => {
  for (const listener of downloadProgressListeners) {
    listener(payload)
  }
}

if (isE2EObserverEnabled) {
  ipcRenderer.on('ai-run-event', (_event: Electron.IpcRendererEvent, data: AiRunEvent) => {
    emitE2EAiRunEvent(data)
  })
}

// Custom APIs for renderer
const api: DesktopApi = {
  ingestWeb: (payload): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-web', payload),
  ingestWebs: (payload): Promise<{ success: boolean; created?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-webs', payload),
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> => {
    emitE2EIpcCall('openExternal', String(url || '').trim())
    return ipcRenderer.invoke('open-external', url)
  },
  openPath: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    const safePath = String(filePath || '').trim()
    emitE2EIpcCall('openPath', safePath)
    return ipcRenderer.invoke('open-path', filePath)
  },
  openPathWithApplication: (payload) => ipcRenderer.invoke('open-path-with-application', payload),
  revealPath: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    const safePath = String(filePath || '').trim()
    emitE2EIpcCall('revealPath', safePath)
    return ipcRenderer.invoke('reveal-path', filePath)
  },
  pathInfo: (filePath: string) => ipcRenderer.invoke('path-info', filePath),
  pickDirectory: () => {
    emitE2EIpcCall('pickDirectory')
    return ipcRenderer.invoke('pick-directory')
  },
  pickApplication: () => ipcRenderer.invoke('pick-application'),
  search: (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) =>
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
  workspaceSetRootPath: (payload) => ipcRenderer.invoke('workspace-set-root-path', payload),
  workspaceDelete: (workspaceId: string) => ipcRenderer.invoke('workspace-delete', workspaceId),
  workspaceTree: (payload) => ipcRenderer.invoke('workspace-tree', payload),
  workspaceScan: (payload) => {
    emitE2EIpcCall('workspaceScan', {
      workspaceId: String(payload.workspaceId || '').trim()
    })
    return ipcRenderer.invoke('workspace-scan', payload)
  },
  workspacePrepare: (payload) => {
    emitE2EIpcCall('workspacePrepare', {
      workspaceId: String(payload.workspaceId || '').trim()
    })
    return ipcRenderer.invoke('workspace-prepare', payload)
  },
  workspaceIndexJobGet: (payload) => ipcRenderer.invoke('workspace-index-job-get', payload),
  onWorkspaceIndexJobProgress: (cb) => {
    workspaceIndexJobProgressListeners.add(cb)
    return () => {
      workspaceIndexJobProgressListeners.delete(cb)
    }
  },
  referenceItemList: (payload) => {
    emitE2EIpcCall('referenceItemList')
    return ipcRenderer.invoke('reference-item-list', payload)
  },
  webSourceList: (payload) => ipcRenderer.invoke('web-source-list', payload),
  webSourcesScan: (payload) => ipcRenderer.invoke('web-sources-scan', payload),
  webSourcesPrepare: (payload) => ipcRenderer.invoke('web-sources-prepare', payload),
  webSourceRefresh: async (payload) => {
    emitE2EIpcCall('webSourceRefresh', {
      workspaceId: String(payload.workspaceId || '').trim(),
      webSourceId: String(payload.webSourceId || '').trim()
    })
    return ipcRenderer.invoke('web-source-refresh', payload)
  },
  webSourceDelete: (payload) => ipcRenderer.invoke('web-source-delete', payload),
  legacyLocalImportMigrationStatus: () =>
    ipcRenderer.invoke('legacy-local-import-migration-status'),
  listChunks: (payload) => ipcRenderer.invoke('list-chunks', payload),
  deleteDocuments: (
    ids: string[]
  ): Promise<{ success: boolean; deletedDocs?: number; deletedChunks?: number; error?: string }> =>
    ipcRenderer.invoke('delete-documents', ids),
  dropDocumentsTable: (): Promise<{ success: boolean; existed?: boolean; error?: string }> =>
    ipcRenderer.invoke('drop-documents-table'),
  sourceListRefresh: (cb: () => void) => {
    const listener = (): void => cb()
    ipcRenderer.on('source-list-refresh', listener)
    return () => {
      ipcRenderer.removeListener('source-list-refresh', listener)
    }
  },
  downloadModel: async (repoId: string): Promise<{ success: boolean; error?: string }> => {
    const safeRepoId = String(repoId || '').trim()
    emitE2EIpcCall('downloadModel', safeRepoId)
    return ipcRenderer.invoke('download-model', repoId)
  },
  onDownloadProgress: (cb) => {
    downloadProgressListeners.add(cb)
  },
  removeDownloadProgressListeners: () => {
    downloadProgressListeners.clear()
  },
  getActiveDownload: () => ipcRenderer.invoke('get-active-download'),
  deleteModel: (repoId: string): Promise<{ success: boolean; error?: string }> => {
    const safeRepoId = String(repoId || '').trim()
    emitE2EIpcCall('deleteModel', safeRepoId)
    return ipcRenderer.invoke('delete-model', repoId)
  },
  getModels: () => {
    emitE2EIpcCall('getModels')
    return ipcRenderer.invoke('get-models')
  },
  getEmbeddingStatus: () => ipcRenderer.invoke('get-embedding-status'),
  readFile: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('read-file', filePath),
  attachmentPick: (payload) => {
    emitE2EIpcCall('attachmentPick')
    return ipcRenderer.invoke('attachment-pick', payload)
  },
  attachmentSaveFile: (payload) => {
    emitE2EIpcCall('attachmentSaveFile')
    return ipcRenderer.invoke('attachment-save-file', payload)
  },

  // Chat & LLM
  chatSessionList: () => ipcRenderer.invoke('chat-session-list'),
  chatSessionSave: (session) => ipcRenderer.invoke('chat-session-save', session),
  chatSessionMarkViewed: (id: string) => ipcRenderer.invoke('chat-session-mark-viewed', id),
  chatSessionDelete: (id: string) => ipcRenderer.invoke('chat-session-delete', id),
  chatMessageList: (sessionId: string) => ipcRenderer.invoke('chat-message-list', sessionId),
  chatSessionOpen: (payload) => ipcRenderer.invoke('chat-session-open', payload),
  chatSessionRunSummaries: (payload) => ipcRenderer.invoke('chat-session-run-summaries', payload),
  chatRunEventsGet: (payload) => ipcRenderer.invoke('chat-run-events-get', payload),
  chatSessionSnapshotGet: (payload) => ipcRenderer.invoke('chat-session-snapshot-get', payload),
  chatSubmit: (payload) => {
    emitE2EIpcCall('chatSubmit')
    return ipcRenderer.invoke('chat-submit', payload)
  },
  chatTurnRetractLatest: (payload) => ipcRenderer.invoke('chat-turn-retract-latest', payload),
  llmConfigList: () => {
    emitE2EIpcCall('llmConfigList')
    return ipcRenderer.invoke('llm-config-list')
  },
  llmConfigSave: (config) => ipcRenderer.invoke('llm-config-save', config),
  llmConfigDelete: (id: string) => ipcRenderer.invoke('llm-config-delete', id),
  llmConfigModelList: (id: string) => {
    emitE2EIpcCall('llmConfigModelList', id)
    return ipcRenderer.invoke('llm-config-model-list', id)
  },
  isE2EMode: () => isE2EObserverEnabled,
  aiRuntimeSettingsGet: () => ipcRenderer.invoke('ai-runtime-settings-get'),
  aiRuntimeSettingsSave: (settings) => ipcRenderer.invoke('ai-runtime-settings-save', settings),

  aiRunCancel: (runId: string) => ipcRenderer.invoke('ai-run-cancel', runId),
  aiRunApprovalBatchDecide: (payload) => {
    emitE2EIpcCall('aiRunApprovalBatchDecide')
    return ipcRenderer.invoke('ai-run-approval-batch-decide', payload)
  },
  aiRunUserTakeoverConfirm: (payload) => {
    emitE2EIpcCall('aiRunUserTakeoverConfirm')
    return ipcRenderer.invoke('ai-run-user-takeover-confirm', payload)
  },
  aiContextUsageGet: (payload) => ipcRenderer.invoke('ai-context-usage-get', payload),
  browserPanelSetBounds: (payload) => ipcRenderer.invoke('browser-panel-set-bounds', payload),
  browserPanelShow: () => ipcRenderer.invoke('browser-panel-show'),
  browserPanelHide: () => ipcRenderer.invoke('browser-panel-hide'),
  browserPanelReload: () => ipcRenderer.invoke('browser-panel-reload'),
  browserPanelOpenExternal: () => ipcRenderer.invoke('browser-panel-open-external'),
  browserPanelStateGet: () => ipcRenderer.invoke('browser-panel-state-get'),
  browserPanelZoomIn: () => ipcRenderer.invoke('browser-panel-zoom-in'),
  browserPanelZoomOut: () => ipcRenderer.invoke('browser-panel-zoom-out'),
  browserPanelZoomReset: () => ipcRenderer.invoke('browser-panel-zoom-reset'),
  docxApplyGet: (payload) => ipcRenderer.invoke('docx-apply-get', payload),
  aiFileChangeList: (payload) => ipcRenderer.invoke('ai-file-change-list', payload),
  aiFileChangeGet: (payload) => ipcRenderer.invoke('ai-file-change-get', payload),
  aiFileChangeRevert: (payload) => {
    emitE2EIpcCall('aiFileChangeRevert')
    return ipcRenderer.invoke('ai-file-change-revert', payload)
  },
  appUpdateGetSnapshot: () => ipcRenderer.invoke(APP_UPDATE_GET_SNAPSHOT_CHANNEL),
  appUpdateCheck: async () => {
    emitE2EIpcCall('appUpdateCheck')
    return await ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL)
  },
  appUpdateInstall: async () => {
    emitE2EIpcCall('appUpdateInstall')
    return await ipcRenderer.invoke(APP_UPDATE_INSTALL_CHANNEL)
  },
  onAppUpdateStatus: (cb: (snapshot: AppUpdateSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: AppUpdateSnapshot): void => {
      cb(snapshot)
    }
    ipcRenderer.on(APP_UPDATE_STATUS_CHANNEL, listener)
    return () => {
      ipcRenderer.removeListener(APP_UPDATE_STATUS_CHANNEL, listener)
    }
  },
  onAiRunEvent: (cb: (event: AiRunEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: AiRunEvent): void => {
      cb(data)
    }
    ipcRenderer.on('ai-run-event', listener)
    return () => {
      ipcRenderer.removeListener('ai-run-event', listener)
    }
  },
  onBrowserPanelStateChange: (cb: (state: BrowserPanelState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: BrowserPanelState): void => {
      cb(state)
    }
    ipcRenderer.on('browser-panel-state-change', listener)
    return () => {
      ipcRenderer.removeListener('browser-panel-state-change', listener)
    }
  }
}

ipcRenderer.on('download-progress', (_event, data: DownloadProgress) => {
  emitDownloadProgress(data)
})

ipcRenderer.on('workspace-index-job-progress', (_event, data: WorkspaceIndexJobRecord) => {
  for (const listener of workspaceIndexJobProgressListeners) {
    listener(data)
  }
})

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
