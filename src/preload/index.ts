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
  APP_UPDATE_DOWNLOAD_CHANNEL,
  APP_UPDATE_GET_SNAPSHOT_CHANNEL,
  APP_UPDATE_INSTALL_CHANNEL,
  APP_UPDATE_STATUS_CHANNEL
} from '../shared/constants'
import type { DesktopApi, DownloadProgress } from './api'

const isE2EFixtureMode = process.env.NCURATOR_E2E_MODE === '1'
const isE2EObserverEnabled = isE2EFixtureMode || process.env.NCURATOR_E2E_OBSERVER === '1'
const downloadProgressListeners = new Set<(progressData: DownloadProgress) => void>()
const workspaceIndexJobProgressListeners = new Set<(job: WorkspaceIndexJobRecord) => void>()
const appUpdateFixtureListeners = new Set<(snapshot: AppUpdateSnapshot) => void>()
const systemNotificationSessionListeners = new Set<(sessionId: string) => void>()
let pendingSystemNotificationSessionId: string | null = null
const APP_UPDATE_E2E_SET_SNAPSHOT_EVENT = 'ncurator-e2e-app-update-set-snapshot'

let appUpdateFixtureSnapshot: AppUpdateSnapshot = {
  status: 'idle',
  currentVersion: '0.1.0',
  isPackaged: true,
  updateSupported: true,
  platform: process.platform
}

const waitForAppUpdateFixtureStep = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 1_000))
}

const setAppUpdateFixtureSnapshot = (snapshot: AppUpdateSnapshot): void => {
  appUpdateFixtureSnapshot = { ...snapshot }
  for (const listener of appUpdateFixtureListeners) {
    listener({ ...appUpdateFixtureSnapshot })
  }
}

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

ipcRenderer.on('system-notification-open-session', (_event, sessionId: string) => {
  pendingSystemNotificationSessionId = sessionId
  for (const listener of systemNotificationSessionListeners) listener(sessionId)
  if (systemNotificationSessionListeners.size > 0) pendingSystemNotificationSessionId = null
})

if (isE2EObserverEnabled) {
  ipcRenderer.on('ai-run-event', (_event: Electron.IpcRendererEvent, data: AiRunEvent) => {
    emitE2EAiRunEvent(data)
  })
}

if (isE2EFixtureMode) {
  window.addEventListener(APP_UPDATE_E2E_SET_SNAPSHOT_EVENT, (event) => {
    const detail = (event as CustomEvent<string>).detail
    if (typeof detail !== 'string') return
    try {
      setAppUpdateFixtureSnapshot(JSON.parse(detail) as AppUpdateSnapshot)
    } catch (error) {
      console.error('Failed to apply app update E2E snapshot', error)
    }
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
  fileWatchStart: (payload) => {
    emitE2EIpcCall('fileWatchStart', { filePath: String(payload.filePath || '').trim() })
    return ipcRenderer.invoke('file-watch-start', payload)
  },
  fileWatchCheck: (payload) => {
    emitE2EIpcCall('fileWatchCheck', { watchId: String(payload.watchId || '').trim() })
    return ipcRenderer.invoke('file-watch-check', payload)
  },
  fileWatchStop: (payload) => {
    emitE2EIpcCall('fileWatchStop', { watchId: String(payload.watchId || '').trim() })
    return ipcRenderer.invoke('file-watch-stop', payload)
  },
  onFileWatchChange: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, change: Parameters<typeof cb>[0]): void =>
      cb(change)
    ipcRenderer.on('file-watch-changed', listener)
    return () => {
      ipcRenderer.removeListener('file-watch-changed', listener)
    }
  },
  revealPath: (filePath: string): Promise<{ success: boolean; error?: string }> => {
    const safePath = String(filePath || '').trim()
    emitE2EIpcCall('revealPath', safePath)
    return ipcRenderer.invoke('reveal-path', filePath)
  },
  pickDirectory: async () => {
    emitE2EIpcCall('pickDirectory')
    const response = await ipcRenderer.invoke('pick-directory')
    emitE2EIpcCall('pickDirectoryResult', response)
    return response
  },
  pickFile: (defaultPath?: string) => ipcRenderer.invoke('pick-file', defaultPath),
  listOpenWithApplications: (payload) => {
    emitE2EIpcCall('listOpenWithApplications', {
      filePath: String(payload.filePath || '').trim()
    })
    return ipcRenderer.invoke('list-open-with-applications', payload)
  },
  openFileWithApplication: (payload) => {
    emitE2EIpcCall('openFileWithApplication', {
      filePath: String(payload.filePath || '').trim(),
      applicationId: String(payload.applicationId || '').trim()
    })
    return ipcRenderer.invoke('open-file-with-application', payload)
  },
  search: (query: string, sourceType?: SearchSourceFilter, documentIds?: string[]) =>
    ipcRenderer.invoke('search', query, sourceType, documentIds),
  workspaceList: () => ipcRenderer.invoke('workspace-list'),
  workspaceCreate: (payload) => ipcRenderer.invoke('workspace-create', payload),
  workspaceSetRootPath: (payload) => ipcRenderer.invoke('workspace-set-root-path', payload),
  workspaceDelete: (workspaceId: string) => ipcRenderer.invoke('workspace-delete', workspaceId),
  workspaceTree: (payload) => ipcRenderer.invoke('workspace-tree', payload),
  workspaceDirectoryList: (payload) => {
    emitE2EIpcCall('workspaceDirectoryList', {
      workspaceId: String(payload.workspaceId || '').trim(),
      relativePath: String(payload.relativePath || '')
    })
    return ipcRenderer.invoke('workspace-directory-list', payload)
  },
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
  fileExists: (filePath: string): Promise<boolean> => ipcRenderer.invoke('file-exists', filePath),
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
  chatSessionUiStateSave: (payload) => ipcRenderer.invoke('chat-session-ui-state-save', payload),
  workbenchUiStateGet: () => ipcRenderer.invoke('workbench-ui-state-get'),
  workbenchUiStateSave: (payload) => ipcRenderer.invoke('workbench-ui-state-save', payload),
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
  browserTabList: (payload) => ipcRenderer.invoke('browser-tab-list', payload),
  browserTabCreate: (payload) => ipcRenderer.invoke('browser-tab-create', payload),
  browserTabActivate: (payload) => ipcRenderer.invoke('browser-tab-activate', payload),
  browserTabClose: (payload) => ipcRenderer.invoke('browser-tab-close', payload),
  browserTabNavigate: (payload) => ipcRenderer.invoke('browser-tab-navigate', payload),
  browserTabBack: (payload) => ipcRenderer.invoke('browser-tab-back', payload),
  browserTabForward: (payload) => ipcRenderer.invoke('browser-tab-forward', payload),
  browserPanelShow: (payload) => ipcRenderer.invoke('browser-panel-show', payload),
  browserPanelHide: (payload) => ipcRenderer.invoke('browser-panel-hide', payload),
  browserPanelOpenMenu: (payload) => ipcRenderer.invoke('browser-panel-open-menu', payload),
  browserPanelCloseMenu: () => ipcRenderer.invoke('browser-panel-close-menu'),
  browserPanelCapture: (payload) => ipcRenderer.invoke('browser-panel-capture', payload),
  browserResourceMenuOpen: (payload) => ipcRenderer.invoke('browser-resource-menu-open', payload),
  browserPanelReload: (payload) => ipcRenderer.invoke('browser-panel-reload', payload),
  browserPanelStop: (payload) => ipcRenderer.invoke('browser-panel-stop', payload),
  browserPanelOpenExternal: (payload) => ipcRenderer.invoke('browser-panel-open-external', payload),
  browserPanelStateGet: (payload) => ipcRenderer.invoke('browser-panel-state-get', payload),
  browserPanelZoomIn: (payload) => ipcRenderer.invoke('browser-panel-zoom-in', payload),
  browserPanelZoomOut: (payload) => ipcRenderer.invoke('browser-panel-zoom-out', payload),
  browserPanelZoomReset: (payload) => ipcRenderer.invoke('browser-panel-zoom-reset', payload),
  docxApplyGet: (payload) => ipcRenderer.invoke('docx-apply-get', payload),
  aiFileChangeList: (payload) => ipcRenderer.invoke('ai-file-change-list', payload),
  aiFileChangeGet: (payload) => ipcRenderer.invoke('ai-file-change-get', payload),
  aiFileChangeRevert: (payload) => {
    emitE2EIpcCall('aiFileChangeRevert')
    return ipcRenderer.invoke('ai-file-change-revert', payload)
  },
  appUpdateGetSnapshot: () =>
    isE2EFixtureMode
      ? Promise.resolve({ ...appUpdateFixtureSnapshot })
      : ipcRenderer.invoke(APP_UPDATE_GET_SNAPSHOT_CHANNEL),
  appUpdateCheck: async () => {
    emitE2EIpcCall('appUpdateCheck')
    if (!isE2EFixtureMode) {
      return await ipcRenderer.invoke(APP_UPDATE_CHECK_CHANNEL)
    }

    setAppUpdateFixtureSnapshot({
      ...appUpdateFixtureSnapshot,
      status: 'checking',
      error: undefined
    })
    await waitForAppUpdateFixtureStep()
    setAppUpdateFixtureSnapshot({
      ...appUpdateFixtureSnapshot,
      status: 'available',
      availableVersion: '0.1.1',
      releaseName: 'v0.1.1',
      releaseDate: '2026-07-13T08:00:00.000Z'
    })
    return {
      success: true,
      snapshot: { ...appUpdateFixtureSnapshot }
    }
  },
  appUpdateDownload: async () => {
    emitE2EIpcCall('appUpdateDownload')
    if (!isE2EFixtureMode) {
      return await ipcRenderer.invoke(APP_UPDATE_DOWNLOAD_CHANNEL)
    }
    if (
      appUpdateFixtureSnapshot.status !== 'available' &&
      !(appUpdateFixtureSnapshot.status === 'error' && appUpdateFixtureSnapshot.availableVersion)
    ) {
      return {
        success: false,
        snapshot: { ...appUpdateFixtureSnapshot },
        error: '当前没有可下载的更新'
      }
    }
    setAppUpdateFixtureSnapshot({
      ...appUpdateFixtureSnapshot,
      status: 'downloading',
      progressPercent: 0,
      error: undefined
    })
    await waitForAppUpdateFixtureStep()
    setAppUpdateFixtureSnapshot({
      ...appUpdateFixtureSnapshot,
      status: 'downloading',
      progressPercent: 42,
      transferredBytes: 42 * 1024 * 1024,
      totalBytes: 100 * 1024 * 1024,
      bytesPerSecond: 8 * 1024 * 1024
    })
    await waitForAppUpdateFixtureStep()
    setAppUpdateFixtureSnapshot({
      ...appUpdateFixtureSnapshot,
      status: 'downloaded',
      progressPercent: 100,
      transferredBytes: 100 * 1024 * 1024
    })
    return {
      success: true,
      snapshot: { ...appUpdateFixtureSnapshot }
    }
  },
  appUpdateInstall: async () => {
    emitE2EIpcCall('appUpdateInstall')
    if (!isE2EFixtureMode) {
      return await ipcRenderer.invoke(APP_UPDATE_INSTALL_CHANNEL)
    }
    if (appUpdateFixtureSnapshot.status !== 'downloaded') {
      return {
        success: false,
        snapshot: { ...appUpdateFixtureSnapshot },
        error: '更新包尚未下载完成'
      }
    }
    return {
      success: true,
      snapshot: { ...appUpdateFixtureSnapshot }
    }
  },
  onAppUpdateStatus: (cb: (snapshot: AppUpdateSnapshot) => void) => {
    if (isE2EFixtureMode) {
      appUpdateFixtureListeners.add(cb)
      return () => {
        appUpdateFixtureListeners.delete(cb)
      }
    }
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
  onSystemNotificationOpenSession: (cb: (sessionId: string) => void) => {
    systemNotificationSessionListeners.add(cb)
    if (pendingSystemNotificationSessionId) {
      const sessionId = pendingSystemNotificationSessionId
      pendingSystemNotificationSessionId = null
      queueMicrotask(() => cb(sessionId))
    }
    return () => {
      systemNotificationSessionListeners.delete(cb)
    }
  },
  onWorkbenchUiFlushRequest: (cb: () => void | Promise<void>) => {
    const listener = (_event: Electron.IpcRendererEvent, requestId: string): void => {
      void Promise.resolve(cb()).finally(() => {
        ipcRenderer.send('workbench-ui-flush-complete', requestId)
      })
    }
    ipcRenderer.on('workbench-ui-flush-request', listener)
    return () => {
      ipcRenderer.removeListener('workbench-ui-flush-request', listener)
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
  },
  onBrowserResourceMenuAction: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, action: 'file' | 'browser'): void => {
      cb(action)
    }
    ipcRenderer.on('browser-resource-menu-action', listener)
    return () => {
      ipcRenderer.removeListener('browser-resource-menu-action', listener)
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
