import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerHandlers } from './ipc/handlers'
import { IngestionService } from './services/ingestion/loader'
import { EmbeddingService } from './services/vector/EmbeddingService'
import { StorageService } from './services/storage/StorageService'
import { ModelService } from './services/model/ModelService'
import { VectorModelDownloadService } from './services/model/VectorModelDownloadService'
import { globalShortcut } from 'electron'
import { loadRootEnvOnce } from './utils/rootEnv'
import { BrowserEmbedService } from './services/browser/BrowserEmbedService'
import { EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT } from './services/browser/constants'
import { ManagedWebCrawlerService } from './services/webCrawler/WebCrawlerService'
import { AppUpdateService } from './services/update/AppUpdateService'
import { APP_ID } from '../shared/constants'

app.commandLine.appendSwitch(
  'remote-debugging-port',
  String(EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT)
)

if (!app.isPackaged) {
  loadRootEnvOnce()
}

const e2eUserDataPath = String(process.env.NCURATOR_USER_DATA_PATH || '').trim()
if (e2eUserDataPath) {
  app.setPath('userData', e2eUserDataPath)
}

const singleInstanceLock = process.env.NCURATOR_E2E_OBSERVER
  ? true
  : app.requestSingleInstanceLock()

function createWindow(): BrowserWindow {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1280,
    minHeight: 820,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } }
      : {}),
    ...(process.platform === 'win32' ? { frame: false } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
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
    shell.openExternal(details.url)
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
    const embeddingService = EmbeddingService.getInstance()
    const storageService = StorageService.getInstance()
    const modelService = ModelService.getInstance()
    const vectorModelDownloadService = VectorModelDownloadService.getInstance({
      modelService,
      embeddingService
    })

    console.log('Starting background initialization of services...')
    embeddingService
      .initialize()
      .catch((err) => console.error('Failed to initialize EmbeddingService:', err))
    await storageService.initialize()

    const mainWindow = createWindow()
    const appUpdateService = new AppUpdateService()
    const browserEmbedService = new BrowserEmbedService(mainWindow)
    const webCrawlerBaseDirectory = join(app.getPath('userData'), 'web-crawler')
    const webCrawlerService = new ManagedWebCrawlerService({
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
      webCrawlerService
    })
    appUpdateService.initialize()
    appUpdateService.checkForUpdatesOnLaunch()

    app.on('before-quit', () => {
      void storageService.failInterruptedWorkspaceIndexJobs()
      void webCrawlerService.close()
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
