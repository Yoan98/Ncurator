import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerHandlers } from './ipc/handlers'
import { IngestionService } from './services/ingestion/loader'
import { DEFAULT_EMBEDDING_MODEL_NAME, EmbeddingService } from './services/vector/EmbeddingService'
import { EmbeddingRuntimeClient } from './services/vector/runtime/EmbeddingRuntimeClient'
import { StorageService } from './services/storage/StorageService'
import { ModelService } from './services/model/ModelService'
import { VectorModelDownloadService } from './services/model/VectorModelDownloadService'
import { globalShortcut } from 'electron'
import { loadRootEnvOnce } from './utils/rootEnv'
import { BrowserEmbedService } from './services/browser/BrowserEmbedService'
import { CdpEndpointService } from './services/browser/CdpEndpointService'
import { createWebCrawlerService } from './services/webCrawler/createWebCrawlerService'
import { AppUpdateService } from './services/update/AppUpdateService'
import { APP_ID } from '../shared/constants'
import { getModelsPath } from './utils/paths'
import { terminalSessionManager } from './services/ai/human/tools/terminal/TerminalSessionManager'
import { AppShutdownCoordinator } from './services/AppShutdownCoordinator'
import { SystemNotificationService } from './services/SystemNotificationService'
import { TelemetryService } from './services/telemetry/TelemetryService'

if (!app.isPackaged) {
  loadRootEnvOnce()
}

const e2eUserDataPath = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
if (e2eUserDataPath) {
  app.setPath('userData', e2eUserDataPath)
} else if (!app.isPackaged) {
  app.setPath('userData', `${app.getPath('userData')}-dev`)
}

app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
app.commandLine.appendSwitch('remote-debugging-port', '0')

const singleInstanceLock = process.env.NCURATOR_E2E_OBSERVER
  ? true
  : app.requestSingleInstanceLock()
const shutdownCoordinator = new AppShutdownCoordinator()
let quitAfterShutdown = false
let shutdownRequested = false
let rendererFlushSequence = 0

const requestRendererWorkbenchFlush = async (window: BrowserWindow): Promise<void> => {
  if (window.isDestroyed() || window.webContents.isDestroyed()) return
  rendererFlushSequence += 1
  const requestId = `workbench-flush-${rendererFlushSequence}`
  await new Promise<void>((resolve) => {
    const finish = (): void => {
      ipcMain.removeListener('workbench-ui-flush-complete', handleComplete)
      clearTimeout(timeout)
      resolve()
    }
    const handleComplete = (_event: Electron.IpcMainEvent, completedRequestId: string): void => {
      if (completedRequestId === requestId) finish()
    }
    ipcMain.on('workbench-ui-flush-complete', handleComplete)
    const timeout = setTimeout(finish, 2_000)
    window.webContents.send('workbench-ui-flush-request', requestId)
  })
}

const prepareAppShutdown = async (): Promise<void> => {
  if (quitAfterShutdown) return
  shutdownRequested = true
  const failures = await shutdownCoordinator.shutdown()
  for (const failure of failures) {
    console.error(`[APP-SHUTDOWN] ${failure.name} failed:`, failure.error)
  }
  quitAfterShutdown = true
}

if (process.env.NCURATOR_E2E_OBSERVER) {
  ;(
    globalThis as typeof globalThis & {
      __NCURATOR_E2E_PREPARE_SHUTDOWN__?: () => Promise<void>
    }
  ).__NCURATOR_E2E_PREPARE_SHUTDOWN__ = prepareAppShutdown
}

app.on('before-quit', (event) => {
  if (quitAfterShutdown) return
  event.preventDefault()
  if (shutdownRequested) return
  void prepareAppShutdown().then(() => {
    app.quit()
  })
})

const INITIAL_WINDOW_WIDTH = 1400
const INITIAL_WINDOW_HEIGHT = 800
const MIN_WINDOW_WIDTH = 1100
const MIN_WINDOW_HEIGHT = 720

function getInitialWindowBounds(): { width: number; height: number; x: number; y: number } {
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(INITIAL_WINDOW_WIDTH, Math.max(MIN_WINDOW_WIDTH, workArea.width))
  const height = Math.min(INITIAL_WINDOW_HEIGHT, Math.max(MIN_WINDOW_HEIGHT, workArea.height))
  const x = workArea.x + Math.max(0, Math.round((workArea.width - width) / 2))
  const y = workArea.y + Math.max(0, Math.round((workArea.height - height) / 2))

  return {
    width,
    height,
    x,
    y
  }
}

function createWindow(): BrowserWindow {
  const initialWindowBounds = getInitialWindowBounds()

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    ...initialWindowBounds,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#FBFBFA',
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === 'win32'
      ? {
          titleBarStyle: 'hidden',
          titleBarOverlay: {
            color: '#FBFBFA',
            symbolColor: '#37352F',
            height: 36
          }
        }
      : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  let closeAfterRendererFlush = false
  mainWindow.on('close', (event) => {
    if (quitAfterShutdown || shutdownRequested || closeAfterRendererFlush) return
    event.preventDefault()
    void requestRendererWorkbenchFlush(mainWindow).finally(() => {
      closeAfterRendererFlush = true
      if (!mainWindow.isDestroyed()) mainWindow.close()
    })
  })

  mainWindow.on('ready-to-show', () => {
    if (process.env.NCURATOR_E2E_WINDOW_MODE === 'visible') {
      mainWindow.show()
      mainWindow.focus()
      return
    }
    mainWindow.showInactive()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    try {
      const parsed = new URL(details.url)
      if (parsed.protocol === 'ncurator:') {
        return { action: 'deny' }
      }
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(parsed.toString()).catch((error) => {
          console.error('[WINDOW-OPEN] Failed to open external URL:', error)
        })
      }
    } catch (error) {
      console.error('[WINDOW-OPEN] Invalid URL:', error)
    }
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  globalShortcut.register('F12', () => {
    const wc = mainWindow.webContents

    if (wc.isDevToolsOpened()) {
      wc.closeDevTools()
    } else {
      wc.openDevTools({ mode: 'right' })
    }
  })

  return mainWindow
}

if (!singleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  // This method will be called when Electron has finished
  // initialization and is ready to create browser windows.
  // Some APIs can only be used after this event occurs.
  app.whenReady().then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId(APP_ID)

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    // IPC test
    ipcMain.on('ping', () => console.log('pong'))

    // Initialize services
    const ingestionService = IngestionService.getInstance()
    const embeddingRuntimeClient = new EmbeddingRuntimeClient({
      entryPath: fileURLToPath(new URL('./embeddingRuntimeProcess.js', import.meta.url)),
      modelsPath: getModelsPath(),
      modelName: DEFAULT_EMBEDDING_MODEL_NAME
    })
    const embeddingService = new EmbeddingService({
      executor: embeddingRuntimeClient,
      modelName: DEFAULT_EMBEDDING_MODEL_NAME
    })
    const storageService = StorageService.getInstance()
    const modelService = ModelService.getInstance()
    const vectorModelDownloadService = VectorModelDownloadService.getInstance({
      modelService,
      embeddingService
    })

    console.log('Starting background initialization of services...')
    await modelService
      .reuseDownloadedModelFromAlternatePath(DEFAULT_EMBEDDING_MODEL_NAME)
      .catch((err) => console.error('Failed to reuse downloaded embedding model:', err))
    embeddingService
      .initialize()
      .catch((err) => console.error('Failed to initialize EmbeddingService:', err))
    await storageService.initialize()

    const mainWindow = createWindow()
    const systemNotificationService = new SystemNotificationService({
      settingsStore: storageService.aiRuntimeSettings,
      getMainWindow: () => BrowserWindow.getAllWindows()[0] || null,
      createMainWindow: () => createWindow(),
      notificationIcon: icon
    })
    const appUpdateService = new AppUpdateService()
    const cdpEndpointService = new CdpEndpointService({
      userDataPath: app.getPath('userData')
    })
    const browserEmbedService = new BrowserEmbedService(
      mainWindow,
      cdpEndpointService,
      storageService.browserTabs
    )
    const telemetryService = new TelemetryService({
      userDataPath: app.getPath('userData'),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged
    })
    const webCrawlerBaseDirectory = join(app.getPath('userData'), 'web-crawler')
    const webCrawlerService = createWebCrawlerService({
      appRootPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sidecarEnv: {
        CRAWL4_AI_BASE_DIRECTORY: webCrawlerBaseDirectory
      }
    })

    registerHandlers({
      ingestionService,
      embeddingService,
      storageService,
      modelService,
      vectorModelDownloadService,
      browserEmbedService,
      webCrawlerService,
      systemNotificationService,
      telemetryService
    })
    telemetryService.track('app_started')
    appUpdateService.initialize()
    appUpdateService.checkForUpdatesOnLaunch()

    shutdownCoordinator.register({
      name: 'workspace-index-jobs',
      dispose: () => storageService.failInterruptedWorkspaceIndexJobs()
    })
    shutdownCoordinator.register({
      name: 'embedding-service',
      dispose: () => embeddingService.close()
    })
    shutdownCoordinator.register({
      name: 'web-crawler',
      dispose: () => webCrawlerService.close()
    })
    shutdownCoordinator.register({
      name: 'browser-embed-service',
      dispose: () => browserEmbedService.dispose()
    })
    shutdownCoordinator.register({
      name: 'terminal-session-manager',
      dispose: () => terminalSessionManager.dispose()
    })
    shutdownCoordinator.register({
      name: 'telemetry',
      dispose: () => telemetryService.flush()
    })
    shutdownCoordinator.register({
      name: 'workbench-renderer-state',
      dispose: () => requestRendererWorkbenchFlush(mainWindow)
    })

    vectorModelDownloadService
      .initialize()
      .catch((err) => console.error('Failed to initialize VectorModelDownloadService:', err))

    app.on('activate', function () {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  // Quit when all windows are closed, except on macOS. There, it's common
  // for applications and their menu bar to stay active until the user quits
  // explicitly with Cmd + Q.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
