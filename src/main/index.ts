import { initializeAppMenu } from './services/app/AppMenu'
import { getAppRuntime, initializeAppRuntime } from './services/app/AppRuntime'
import { downloadPageUrl } from '../shared/appPreferences'
import { app, shell, BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { fileURLToPath } from 'node:url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerHandlers, registerOpenExternalHandler } from './ipc/handlers'
import { IngestionService } from './services/ingestion/loader'
import { DEFAULT_EMBEDDING_MODEL_NAME, EmbeddingService } from './services/vector/EmbeddingService'
import { EmbeddingRuntimeClient } from './services/vector/runtime/EmbeddingRuntimeClient'
import { resolveOrtThreadBudget } from './services/vector/indexSpeed'
import { StorageService } from './services/storage/StorageService'
import { ModelService } from './services/model/ModelService'
import { VectorModelDownloadService } from './services/model/VectorModelDownloadService'
import { globalShortcut } from 'electron'
import { loadRootEnvOnce } from './utils/rootEnv'
import { BrowserEmbedService } from './services/browser/BrowserEmbedService'
import { CdpEndpointService } from './services/browser/CdpEndpointService'
import { createWebCrawlerService } from './services/webCrawler/createWebCrawlerService'
import { ElectronWebCrawlerBrowserHost } from './services/webCrawler/ElectronWebCrawlerBrowserHost'
import { AppUpdateService } from './services/update/AppUpdateService'
import { APP_ID, APP_QUIT_CHANNEL, APP_STARTUP_GET_STATUS_CHANNEL } from '../shared/constants'
import type { AiLlmIoRecord, AppStartupStatus } from '../shared/types'
import { getModelsPath, syncUserDataPathFromElectron } from './utils/paths'
import { EmbeddingModelService } from './services/vector/EmbeddingModelService'
import { terminalSessionManager } from './services/ai/human/tools/terminal/TerminalSessionManager'
import { AppShutdownCoordinator } from './services/AppShutdownCoordinator'
import { SystemNotificationService } from './services/SystemNotificationService'
import { TelemetryService } from './services/telemetry/TelemetryService'
import { AppErrorLogService } from './services/logging/AppErrorLogService'
import { DatabaseVersionTooNewError, SqliteCore } from './services/storage/sqlite/SqliteCore'
import { WpsSyncService } from './services/wps/WpsSyncService'
import { setOfficeFileWriteListener } from './services/wps/officeFileWriteNotify'

if (!app.isPackaged) {
  loadRootEnvOnce()
}

const e2eUserDataPath = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
if (e2eUserDataPath) {
  app.setPath('userData', e2eUserDataPath)
} else {
  app.setPath(
    'userData',
    join(app.getPath('appData'), app.isPackaged ? 'ncurator' : 'ncurator-dev')
  )
}
syncUserDataPathFromElectron()

const singleInstanceLock = process.env.NCURATOR_E2E_OBSERVER
  ? true
  : app.requestSingleInstanceLock()
const shutdownCoordinator = new AppShutdownCoordinator()
let appStartupStatus: AppStartupStatus = { mode: 'normal', ...getAppRuntime() }
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
  if (appStartupStatus.mode === 'normal') {
    await Promise.all(BrowserWindow.getAllWindows().map(requestRendererWorkbenchFlush))
  }
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

const INITIAL_WINDOW_WIDTH = 1600
const INITIAL_WINDOW_HEIGHT = 820
const MIN_WINDOW_WIDTH = 1400
const MIN_WINDOW_HEIGHT = 800

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

function attachDarwinLiveResizeThrottle(mainWindow: BrowserWindow): void {
  // macOS live-resize 时系统改窗口快于 Chromium 出帧，会露出底色空白。
  // 拦截 will-resize 并限到 ~60fps 自行 setBounds，减轻 Electron 29+ 的排队丢帧（Windows 无效，不启用）。
  let lastAppliedAt = 0
  let applying = false
  mainWindow.on('will-resize', (event, newBounds) => {
    event.preventDefault()
    if (applying || mainWindow.isDestroyed()) return
    const now = performance.now()
    if (now - lastAppliedAt < 1000 / 60) return
    lastAppliedAt = now
    applying = true
    try {
      mainWindow.setBounds(newBounds)
    } finally {
      applying = false
    }
  })
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
    // 主内容区（右侧/底部边缘）为白色；窗口底色对齐为白，
    // 使 macOS live-resize 时 OS 先填充的一帧与内容同色，消除拖动露白（对齐主流应用做法）。
    backgroundColor: '#ffffff',
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
  if (process.platform === 'darwin') {
    attachDarwinLiveResizeThrottle(mainWindow)
  }
  let closeAfterRendererFlush = false
  mainWindow.on('close', (event) => {
    if (
      appStartupStatus.mode === 'update_required' ||
      quitAfterShutdown ||
      shutdownRequested ||
      closeAfterRendererFlush
    )
      return
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
    initializeAppRuntime(app.getPreferredSystemLanguages())
    appStartupStatus = { mode: 'normal', ...getAppRuntime() }
    initializeAppMenu()
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
    const errorLogService = new AppErrorLogService({
      userDataPath: app.getPath('userData'),
      appVersion: app.getVersion()
    })
    process.on('uncaughtException', (error) => {
      errorLogService.write({
        module: 'main-process',
        error,
        context: { event: 'uncaughtException' }
      })
    })
    process.on('unhandledRejection', (reason) => {
      errorLogService.write({
        module: 'main-process',
        error: reason instanceof Error ? reason : 'Unhandled promise rejection',
        context: { event: 'unhandledRejection' }
      })
    })
    app.on('child-process-gone', (_event, details) => {
      if (details.reason === 'clean-exit') return
      errorLogService.write({
        module: 'electron-child-process',
        error: 'Electron child process exited',
        context: {
          event: 'child-process-gone',
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode
        }
      })
    })
    const appUpdateService = new AppUpdateService({ shutdownApp: prepareAppShutdown })
    appUpdateService.initialize()
    ipcMain.handle(APP_STARTUP_GET_STATUS_CHANNEL, () => ({
      ...appStartupStatus,
      ...getAppRuntime()
    }))
    ipcMain.handle(APP_QUIT_CHANNEL, async () => {
      await prepareAppShutdown()
      app.quit()
    })
    const startupSqlite = new SqliteCore()
    try {
      startupSqlite.initialize()
      startupSqlite.close()
    } catch (error) {
      if (!(error instanceof DatabaseVersionTooNewError)) throw error
      appStartupStatus = {
        mode: 'update_required',
        databaseVersion: error.databaseVersion,
        supportedDatabaseVersion: error.supportedDatabaseVersion,
        ...getAppRuntime(),
        downloadPageUrl: downloadPageUrl(getAppRuntime())
      }
      errorLogService.write({
        module: 'sqlite-migration',
        error,
        context: { event: 'database-version-too-new' }
      })
      registerOpenExternalHandler()
      createWindow()
      appUpdateService.checkForUpdatesOnLaunch()
      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow()
      })
      return
    }

    const ingestionService = IngestionService.getInstance()
    const embeddingRuntimeClient = new EmbeddingRuntimeClient({
      entryPath: fileURLToPath(new URL('./embeddingRuntimeProcess.js', import.meta.url)),
      modelsPath: getModelsPath(),
      modelName: DEFAULT_EMBEDDING_MODEL_NAME,
      errorLogService
    })
    const embeddingService = new EmbeddingService({
      executor: embeddingRuntimeClient,
      modelName: DEFAULT_EMBEDDING_MODEL_NAME
    })
    const storageService = StorageService.getInstance({ errorLogService })
    const modelService = ModelService.getInstance()
    const vectorModelDownloadService = VectorModelDownloadService.getInstance({
      modelService,
      embeddingService
    })

    console.log('Starting background initialization of services...')
    await storageService.initialize()
    const appSettings = await storageService.appSettings.get()
    initializeAppRuntime(app.getPreferredSystemLanguages(), appSettings)
    appStartupStatus = { mode: 'normal', ...getAppRuntime() }
    initializeAppMenu()
    embeddingRuntimeClient.setThreadBudget(resolveOrtThreadBudget(appSettings.knowledgeIndexSpeed))
    const embeddingModelService = new EmbeddingModelService({
      settingsStore: storageService.embeddingSettings,
      documentsStore: storageService.documents,
      embeddingService,
      createLocalExecutor: async () =>
        new EmbeddingRuntimeClient({
          entryPath: fileURLToPath(new URL('./embeddingRuntimeProcess.js', import.meta.url)),
          modelsPath: getModelsPath(),
          modelName: DEFAULT_EMBEDDING_MODEL_NAME,
          threadBudget: resolveOrtThreadBudget(
            (await storageService.appSettings.get()).knowledgeIndexSpeed
          ),
          errorLogService
        })
    })
    await embeddingModelService.initialize()

    const mainWindow = createWindow()
    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      errorLogService.write({
        module: 'renderer',
        error: `Renderer process exited: ${details.reason}`,
        context: { event: 'render-process-gone', exitCode: details.exitCode }
      })
    })
    const systemNotificationService = new SystemNotificationService({
      settingsStore: storageService.appSettings,
      getMainWindow: () => BrowserWindow.getAllWindows()[0] || null,
      createMainWindow: () => createWindow(),
      notificationIcon: icon
    })
    const cdpEndpointService = new CdpEndpointService()
    const browserEmbedService = new BrowserEmbedService(
      mainWindow,
      cdpEndpointService,
      storageService.browserTabs,
      errorLogService
    )
    if (process.env.NCURATOR_E2E_OBSERVER) {
      ;(
        globalThis as typeof globalThis & {
          __NCURATOR_E2E_BROWSER_USE_RUN__?: BrowserEmbedService['run']
        }
      ).__NCURATOR_E2E_BROWSER_USE_RUN__ = (input) => browserEmbedService.run(input)
    }
    const telemetryService = new TelemetryService({
      userDataPath: app.getPath('userData'),
      appVersion: app.getVersion(),
      isPackaged: app.isPackaged
    })
    const webCrawlerBaseDirectory = join(app.getPath('userData'), 'web-crawler')
    const webCrawlerBrowserHost = new ElectronWebCrawlerBrowserHost(cdpEndpointService)
    const webCrawlerService = createWebCrawlerService({
      appRootPath: app.getAppPath(),
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      sidecarEnv: {
        CRAWL4_AI_BASE_DIRECTORY: webCrawlerBaseDirectory
      },
      resolveCdpConnection: () => webCrawlerBrowserHost.getConnection()
    })

    registerHandlers({
      ingestionService,
      embeddingService,
      embeddingModelService,
      storageService,
      modelService,
      vectorModelDownloadService,
      browserEmbedService,
      webCrawlerService,
      systemNotificationService,
      telemetryService,
      errorLogService,
      recordLlmIo:
        process.env.NCURATOR_E2E_OBSERVER === '1'
          ? (record: AiLlmIoRecord) => {
              BrowserWindow.getAllWindows().forEach((window) => {
                if (!window.webContents.isDestroyed()) {
                  window.webContents.send('e2e-llm-io', record)
                }
              })
            }
          : undefined
    })
    const wpsSyncService = new WpsSyncService({
      onNotice: (notice) =>
        BrowserWindow.getAllWindows().forEach((window) => {
          if (!window.webContents.isDestroyed())
            window.webContents.send('wps-integration-notice', notice)
        })
    })
    setOfficeFileWriteListener({
      navigate: (filePath, target, open) => wpsSyncService.navigate(filePath, target, open),
      prepareClose: (filePath) => wpsSyncService.prepareClose(filePath),
      notifyOpened: (filePath) => wpsSyncService.notifyOpened(filePath),
      notifyWritten: (filePath) => wpsSyncService.notifyWritten(filePath)
    })
    await wpsSyncService.start().catch((error) => {
      console.warn(
        '[WPS-SYNC] start skipped:',
        error instanceof Error ? error.message : String(error)
      )
    })
    telemetryService.track('app_started')
    appUpdateService.checkForUpdatesOnLaunch()

    shutdownCoordinator.register({
      name: 'wps-sync',
      dispose: async () => {
        setOfficeFileWriteListener(undefined)
        await wpsSyncService.stop()
      }
    })
    shutdownCoordinator.register({
      name: 'workspace-index-jobs',
      dispose: () => storageService.failInterruptedWorkspaceIndexJobs()
    })
    shutdownCoordinator.register({
      name: 'embedding-service',
      dispose: async () => {
        await embeddingModelService.close()
      }
    })
    shutdownCoordinator.register({
      name: 'web-crawler',
      dispose: async () => {
        await webCrawlerService.close()
        await webCrawlerBrowserHost.close()
      }
    })
    shutdownCoordinator.register({
      name: 'browser-embed-service',
      dispose: () => browserEmbedService.dispose()
    })
    shutdownCoordinator.register({
      name: 'cdp-endpoint',
      dispose: () => cdpEndpointService.dispose()
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
