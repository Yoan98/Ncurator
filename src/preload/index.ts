import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type {
  AiRunEvent,
  JsonValue,
  SearchSourceFilter,
} from '../shared/types'
import type { DesktopApi, DownloadProgress, SettingsE2EApiOverrides } from './api'

const isE2EObserverEnabled = process.env.NCURATOR_E2E_MODE === '1'
let e2eApiOverrides: SettingsE2EApiOverrides | null = null
let modelCatalogCallCount = 0
const downloadProgressListeners = new Set<(progressData: DownloadProgress) => void>()

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

const getE2EApiOverrides = (): SettingsE2EApiOverrides | null => {
  if (!isE2EObserverEnabled) return null
  return e2eApiOverrides
}

const hasOverrideKey = <T extends object>(input: T, key: keyof SettingsE2EApiOverrides): boolean =>
  Object.prototype.hasOwnProperty.call(input, key)

const waitForMs = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

const emitDownloadProgress = (payload: DownloadProgress): void => {
  for (const listener of downloadProgressListeners) {
    listener(payload)
  }
}

// Custom APIs for renderer
const api: DesktopApi = {
  ingestWeb: (payload): Promise<{ success: boolean; count?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-web', payload),
  ingestWebs: (payload): Promise<{ success: boolean; created?: number; error?: string }> =>
    ipcRenderer.invoke('ingest-webs', payload),
  openExternal: (url: string): Promise<{ success: boolean; error?: string }> => {
    const overrides = getE2EApiOverrides()
    const response = overrides?.openExternalResponseByUrl?.[String(url || '').trim()]
    emitE2EIpcCall('openExternal', String(url || '').trim())
    if (response) {
      return Promise.resolve(response)
    }
    return ipcRenderer.invoke('open-external', url)
  },
  openPath: (filePath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('open-path', filePath),
  openPathWithApplication: (payload) => ipcRenderer.invoke('open-path-with-application', payload),
  revealPath: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    const safePath = String(filePath || '').trim()
    const response = getE2EApiOverrides()?.revealPathResponseByPath?.[safePath]
    emitE2EIpcCall('revealPath', safePath)
    if (response) {
      return Promise.resolve(response)
    }
    return ipcRenderer.invoke('reveal-path', filePath)
  },
  pickDirectory: () => {
    const overrides = getE2EApiOverrides()
    if (overrides && hasOverrideKey(overrides, 'pickDirectoryResponse')) {
      return Promise.resolve(overrides.pickDirectoryResponse || { canceled: true })
    }
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
  workspaceList: () => {
    const overrides = getE2EApiOverrides()
    if (overrides && hasOverrideKey(overrides, 'workspaceListResponse')) {
      return Promise.resolve(overrides.workspaceListResponse || { items: [], total: 0 })
    }
    return ipcRenderer.invoke('workspace-list')
  },
  workspaceCreate: (payload) => ipcRenderer.invoke('workspace-create', payload),
  workspaceDelete: (workspaceId: string) => ipcRenderer.invoke('workspace-delete', workspaceId),
  workspaceNodes: (payload) => {
    const overrides = getE2EApiOverrides()
    const workspaceId = String(payload?.workspaceId || '').trim()
    const response = overrides?.workspaceNodesResponseByWorkspaceId?.[workspaceId]
    if (response) {
      return Promise.resolve(response)
    }
    return ipcRenderer.invoke('workspace-nodes', payload)
  },
  workspaceScan: (payload) => {
    emitE2EIpcCall('workspaceScan', {
      workspaceId: String(payload.workspaceId || '').trim()
    })
    return ipcRenderer.invoke('workspace-scan', payload)
  },
  workspacePrepare: (payload) => {
    emitE2EIpcCall(`workspacePrepare:${payload.mode}`, {
      workspaceId: String(payload.workspaceId || '').trim(),
      mode: payload.mode
    })
    return ipcRenderer.invoke('workspace-prepare', payload)
  },
  referenceItemList: (payload) => {
    emitE2EIpcCall('referenceItemList')
    return ipcRenderer.invoke('reference-item-list', payload)
  },
  webSourceList: (payload) => ipcRenderer.invoke('web-source-list', payload),
  webSourceRefresh: async (payload) => {
    emitE2EIpcCall('webSourceRefresh', {
      workspaceId: String(payload.workspaceId || '').trim(),
      webSourceId: String(payload.webSourceId || '').trim()
    })
    await waitForMs(getE2EApiOverrides()?.webSourceRefreshDelayMs || 0)
    return ipcRenderer.invoke('web-source-refresh', payload)
  },
  webSourceDelete: (payload) => ipcRenderer.invoke('web-source-delete', payload),
  legacyLocalImportMigrationStatus: () => {
    const overrides = getE2EApiOverrides()
    if (overrides && hasOverrideKey(overrides, 'legacyLocalImportMigrationStatus')) {
      return Promise.resolve(overrides.legacyLocalImportMigrationStatus ?? null)
    }
    return ipcRenderer.invoke('legacy-local-import-migration-status')
  },
  listChunks: (payload) => ipcRenderer.invoke('list-chunks', payload),
  deleteDocuments: (
    ids: string[]
  ): Promise<{ success: boolean; deletedDocs?: number; deletedChunks?: number; error?: string }> =>
    ipcRenderer.invoke('delete-documents', ids),
  dropDocumentsTable: (): Promise<{ success: boolean; existed?: boolean; error?: string }> =>
    ipcRenderer.invoke('drop-documents-table'),
  sourceListRefresh: (cb: () => void) => ipcRenderer.on('source-list-refresh', () => cb()),
  removeSourceListRefreshListeners: () => ipcRenderer.removeAllListeners('source-list-refresh'),
  downloadModel: async (repoId: string): Promise<{ success: boolean; error?: string }> => {
    const safeRepoId = String(repoId || '').trim()
    emitE2EIpcCall('downloadModel', safeRepoId)
    const overrides = getE2EApiOverrides()
    const response = overrides?.downloadModelResponseByRepoId?.[safeRepoId]
    const progressEvents = overrides?.downloadProgressEventsByRepoId?.[safeRepoId] || []
    if (response) {
      for (const event of progressEvents) {
        await waitForMs(overrides?.downloadProgressDelayMs || 0)
        emitDownloadProgress(event)
      }
      return response
    }
    return ipcRenderer.invoke('download-model', repoId)
  },
  onDownloadProgress: (cb) => {
    downloadProgressListeners.add(cb)
  },
  removeDownloadProgressListeners: () => {
    downloadProgressListeners.clear()
  },
  getModels: () => {
    emitE2EIpcCall('getModels')
    const modelCatalog = getE2EApiOverrides()?.modelCatalog
    if (modelCatalog?.sequence && modelCatalog.sequence.length > 0) {
      const nextEntry =
        modelCatalog.sequence[Math.min(modelCatalogCallCount, modelCatalog.sequence.length - 1)]
      modelCatalogCallCount += 1
      if (nextEntry?.error) {
        return Promise.reject(new Error(nextEntry.error))
      }
      if (nextEntry?.items) {
        return Promise.resolve(nextEntry.items)
      }
      return Promise.resolve([])
    }
    if (modelCatalog?.error) {
      return Promise.reject(new Error(modelCatalog.error))
    }
    if (modelCatalog?.items) {
      return Promise.resolve(modelCatalog.items)
    }
    return ipcRenderer.invoke('get-models')
  },
  getEmbeddingStatus: () => ipcRenderer.invoke('get-embedding-status'),
  readFile: (filePath: string): Promise<Uint8Array> => ipcRenderer.invoke('read-file', filePath),

  // Chat & LLM
  chatSessionList: () => ipcRenderer.invoke('chat-session-list'),
  chatSessionSave: (session) => ipcRenderer.invoke('chat-session-save', session),
  chatSessionDelete: (id: string) => ipcRenderer.invoke('chat-session-delete', id),
  chatMessageList: (sessionId: string) => ipcRenderer.invoke('chat-message-list', sessionId),
  chatMessageSave: (message) => ipcRenderer.invoke('chat-message-save', message),
  llmConfigList: () => {
    emitE2EIpcCall('llmConfigList')
    return ipcRenderer.invoke('llm-config-list')
  },
  llmConfigSave: (config) => ipcRenderer.invoke('llm-config-save', config),
  llmConfigDelete: (id: string) => {
    const response = getE2EApiOverrides()?.llmConfigDeleteResponseById?.[String(id || '').trim()]
    if (response) {
      return Promise.resolve(response)
    }
    return ipcRenderer.invoke('llm-config-delete', id)
  },
  llmConfigSetActive: (id: string) => ipcRenderer.invoke('llm-config-set-active', id),
  llmConfigModelList: (id: string) => {
    emitE2EIpcCall('llmConfigModelList', id)
    const response = getE2EApiOverrides()?.llmModelListResponseByConfigId?.[
      String(id || '').trim()
    ]
    if (response) {
      return Promise.resolve(response)
    }
    return ipcRenderer.invoke('llm-config-model-list', id)
  },
  setE2EApiOverrides: (overrides) => {
    if (!isE2EObserverEnabled) return
    e2eApiOverrides = overrides
    modelCatalogCallCount = 0
  },
  clearE2EApiOverrides: () => {
    if (!isE2EObserverEnabled) return
    e2eApiOverrides = null
    modelCatalogCallCount = 0
  },
  aiRuntimeSettingsGet: () => ipcRenderer.invoke('ai-runtime-settings-get'),
  aiRuntimeSettingsSave: (settings) => ipcRenderer.invoke('ai-runtime-settings-save', settings),

  aiRunStart: (payload) => {
    emitE2EIpcCall('aiRunStart')
    return ipcRenderer.invoke('ai-run-start', payload)
  },
  aiRunCancel: (runId: string) => ipcRenderer.invoke('ai-run-cancel', runId),
  aiRunApprovalDecide: (payload) => {
    emitE2EIpcCall('aiRunApprovalDecide')
    return ipcRenderer.invoke('ai-run-approval-decide', payload)
  },
  fileReviewList: (payload) => ipcRenderer.invoke('file-review-list', payload),
  fileReviewGet: (payload) => ipcRenderer.invoke('file-review-get', payload),
  fileReviewValidate: (payload) => {
    emitE2EIpcCall('fileReviewValidate')
    return ipcRenderer.invoke('file-review-validate', payload)
  },
  fileReviewCommit: (payload) => {
    emitE2EIpcCall('fileReviewCommit')
    return ipcRenderer.invoke('file-review-commit', payload)
  },
  fileReviewDiscard: (payload) => {
    emitE2EIpcCall('fileReviewDiscard')
    return ipcRenderer.invoke('file-review-discard', payload)
  },
  onAiRunEvent: (cb: (event: AiRunEvent) => void) =>
    ipcRenderer.on('ai-run-event', (_event, data) => {
      emitE2EAiRunEvent(data)
      cb(data)
    }),
  removeAiRunEventListeners: () => ipcRenderer.removeAllListeners('ai-run-event')
}

ipcRenderer.on('download-progress', (_event, data: DownloadProgress) => {
  emitDownloadProgress(data)
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
