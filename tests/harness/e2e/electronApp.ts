import path from 'node:path'
import os from 'node:os'
import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import electronPath from 'electron'
import {
  _electron as electron,
  type ConsoleMessage,
  type ElectronApplication,
  type Page
} from 'playwright'
import type { AiRunEvent, JsonValue } from '../../../src/shared/types'

type E2EConsoleLevel = 'log' | 'warning' | 'error'

export type E2ERouteEntry = {
  ts: string
  route: string
}

export type E2EIpcInvokeEntry = {
  ts: string
  name: string
  payload?: JsonValue
}

export type E2EAiRunEventEntry = {
  ts: string
  event: AiRunEvent
}

export type E2EDomEventEntry = {
  ts: string
  name: string
}

export type E2EConsoleEntry = {
  ts: string
  level: E2EConsoleLevel
  text: string
}

export type E2ELifecycleEntry = {
  ts: string
  name: string
  data?: JsonValue
}

export const isExpectedWindowsInspectorTeardownExit = (input: {
  platform: NodeJS.Platform
  lifecycleEntries: readonly E2ELifecycleEntry[]
  testPassed: boolean
}): boolean => {
  if (input.platform !== 'win32' || !input.testPassed) return false

  const exitIndex = input.lifecycleEntries.findLastIndex(
    (entry) => entry.name === 'electron-process-exit'
  )
  if (exitIndex < 0) return false

  const teardownIndex = input.lifecycleEntries.findIndex(
    (entry) => entry.name === 'electron-teardown-started'
  )
  if (teardownIndex < 0 || teardownIndex >= exitIndex) return false
  if (input.lifecycleEntries.some((entry) => entry.name === 'page-crash')) return false

  const exitData = input.lifecycleEntries[exitIndex]?.data as
    | { code?: number | null; signal?: string | null }
    | undefined
  return (exitData?.code === 3221225477 || exitData?.code === 3221226505) && !exitData.signal
}

type E2EObserverState = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  domEventEntries: E2EDomEventEntry[]
}

type E2EWindow = Window & {
  __NCURATOR_E2E_OBSERVER__?: E2EObserverState
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
  __NCURATOR_E2E_RECORD_AI_RUN_EVENT__?: (entry: E2EAiRunEventEntry) => void
}

export type E2ERuntimeSignals = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  domEventEntries: E2EDomEventEntry[]
  consoleEntries: E2EConsoleEntry[]
  lifecycleEntries: E2ELifecycleEntry[]
}

export type LaunchedElectronApp = {
  electronApp: ElectronApplication
  page: Page
  userDataDir: string
  appInfo: E2EAppInfo
  collectSignals: () => Promise<E2ERuntimeSignals>
  close: (input: { tracePath: string; preserveUserData?: boolean }) => Promise<void>
}

export type E2EAppTarget = 'source' | 'package'
export type E2EServiceMode = 'fixture' | 'real'
export type ElectronWindowMode = 'background' | 'visible'

export type E2EAppInfo = {
  target: E2EAppTarget
  isPackaged: boolean
  appPath: string
  executablePath: string
  resourcesPath: string
  version: string
  artifactPath: string | null
  artifactSha256: string | null
}

export type ElectronSignalSink = {
  onAiRunEvent?: (entry: E2EAiRunEventEntry) => void
  onConsole?: (entry: E2EConsoleEntry) => void
  onLifecycle?: (entry: E2ELifecycleEntry) => void
}

const OUT_MAIN_ENTRY = path.resolve(process.cwd(), 'out', 'main', 'index.js')
const APP_ROOT = process.cwd()
const electronApplicationByPage = new WeakMap<Page, ElectronApplication>()

export const pasteTextThroughElectronClipboard = async (
  page: Page,
  value: string
): Promise<boolean> => {
  const electronApp = electronApplicationByPage.get(page)
  if (!electronApp) return false

  return electronApp.evaluate(({ BrowserWindow, clipboard }, text) => {
    const targetWindow =
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((window) => !window.isDestroyed())
    if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
      return false
    }

    clipboard.writeText(text)
    if (clipboard.readText() !== text) return false
    targetWindow.webContents.paste()
    return true
  }, value)
}

const resolveAppTarget = (): E2EAppTarget => {
  const target = String(process.env.NCURATOR_E2E_APP_TARGET || 'source').trim()
  if (target === 'source' || target === 'package') return target
  throw new Error(`Unsupported NCURATOR_E2E_APP_TARGET: ${target}`)
}

const resolveElectronLaunch = async (): Promise<{
  target: E2EAppTarget
  executablePath: string
  args: string[]
  cwd: string
}> => {
  const target = resolveAppTarget()
  if (target === 'source') {
    await access(OUT_MAIN_ENTRY)
    return {
      target,
      executablePath: electronPath as unknown as string,
      args: [APP_ROOT],
      cwd: APP_ROOT
    }
  }

  const executablePath = String(process.env.NCURATOR_E2E_EXECUTABLE || '').trim()
  if (!executablePath) {
    throw new Error('Package E2E requires NCURATOR_E2E_EXECUTABLE')
  }
  await access(executablePath)
  return {
    target,
    executablePath,
    args: [],
    cwd: path.dirname(executablePath)
  }
}

const toConsoleLevel = (message: ConsoleMessage): E2EConsoleLevel => {
  if (message.type() === 'error') return 'error'
  if (message.type() === 'warning') return 'warning'
  return 'log'
}

const pushProcessLog = (
  entries: E2EConsoleEntry[],
  level: E2EConsoleLevel,
  source: string,
  chunk: Buffer | string,
  sink?: ElectronSignalSink
): void => {
  const text = String(chunk)
  if (!text.trim()) return
  const entry = {
    ts: new Date().toISOString(),
    level,
    text: `[${source}] ${text.trim()}`
  }
  entries.push(entry)
  sink?.onConsole?.(entry)
}

const assertLaunchedWorkbenchApp = (page: Page): void => {
  const url = page.url()
  if (url.includes('default_app.asar')) {
    throw new Error(
      [
        'Electron e2e launched the default Electron app instead of NCurator.',
        `pageUrl=${url}`,
        `appRoot=${APP_ROOT}`,
        `mainEntry=${OUT_MAIN_ENTRY}`
      ].join('\n')
    )
  }
}

const buildElectronLaunchEnv = (
  userDataDir: string,
  serviceMode: E2EServiceMode,
  windowMode?: ElectronWindowMode,
  extraEnv?: Readonly<Record<string, string>>
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_')) continue
    if (value !== undefined) {
      env[key] = value
    }
  }

  if (serviceMode === 'fixture') {
    env.NCURATOR_E2E_MODE = '1'
    env.NCURATOR_E2E_OBSERVER = '1'
  } else {
    delete env.NCURATOR_E2E_MODE
    env.NCURATOR_E2E_OBSERVER = '1'
  }
  env.NCURATOR_E2E_WINDOW_MODE = windowMode || process.env.NCURATOR_E2E_WINDOW_MODE || 'background'
  env.NCURATOR_USER_DATA_PATH = userDataDir

  for (const [key, value] of Object.entries(extraEnv || {})) {
    env[key] = value
  }

  return env
}

const installPageObservers = async (page: Page, sink?: ElectronSignalSink): Promise<void> => {
  await page.waitForFunction(() => Boolean(window.api))
  if (sink?.onAiRunEvent) {
    await page.exposeFunction(
      '__NCURATOR_E2E_RECORD_AI_RUN_EVENT__',
      (entry: E2EAiRunEventEntry) => {
        sink.onAiRunEvent?.(entry)
      }
    )
  }

  await page.evaluate(() => {
    const currentWindow = window as E2EWindow
    const now = (): string => new Date().toISOString()
    const routeEntries: E2ERouteEntry[] = [{ ts: now(), route: window.location.hash || '#/' }]
    const ipcInvokeEntries: E2EIpcInvokeEntry[] = []
    const aiRunEventEntries: E2EAiRunEventEntry[] = []
    const domEventEntries: E2EDomEventEntry[] = []

    currentWindow.__NCURATOR_E2E_OBSERVER__ = {
      routeEntries,
      ipcInvokeEntries,
      aiRunEventEntries,
      domEventEntries
    }

    window.addEventListener('hashchange', () => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.routeEntries.push({
        ts: now(),
        route: window.location.hash || '#/'
      })
    })

    window.addEventListener('ncurator-e2e-ipc-call', (event) => {
      const detail = (event as CustomEvent<{ name: string; payload?: JsonValue }>).detail
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeEntries.push({
        ts: now(),
        name: detail.name,
        payload: detail.payload
      })
    })

    window.addEventListener('ncurator-e2e-ai-run-event', (event) => {
      const detail = (event as CustomEvent<AiRunEvent>).detail
      const entry = {
        ts: now(),
        event: detail
      }
      currentWindow.__NCURATOR_E2E_OBSERVER__?.aiRunEventEntries.push(entry)
      currentWindow.__NCURATOR_E2E_RECORD_AI_RUN_EVENT__?.(entry)
    })

    window.addEventListener('check-llm-config', () => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.domEventEntries.push({
        ts: now(),
        name: 'check-llm-config'
      })
    })
  })
}

const focusVisibleElectronWindow = async (electronApp: ElectronApplication): Promise<void> => {
  await electronApp.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window || window.isDestroyed()) return

    if (window.isMinimized()) {
      window.restore()
    }
    window.show()
    window.focus()
  })
}

export const launchElectronApp = async (input: {
  serviceMode: E2EServiceMode
  windowMode?: ElectronWindowMode
  extraEnv?: Readonly<Record<string, string>>
  signalSink?: ElectronSignalSink
  userDataDir?: string
}): Promise<LaunchedElectronApp> => {
  const launch = await resolveElectronLaunch()

  const consoleEntries: E2EConsoleEntry[] = []
  const lifecycleEntries: E2ELifecycleEntry[] = []
  const recordLifecycle = (name: string, data?: JsonValue): void => {
    const entry = {
      ts: new Date().toISOString(),
      name,
      data
    }
    lifecycleEntries.push(entry)
    input.signalSink?.onLifecycle?.(entry)
  }
  const e2eTempRoot = path.resolve(
    String(process.env.NCURATOR_E2E_TEMP_ROOT || '').trim() || os.tmpdir()
  )
  await mkdir(e2eTempRoot, { recursive: true })
  const userDataDir = input.userDataDir
    ? path.resolve(input.userDataDir)
    : await mkdtemp(path.join(e2eTempRoot, 'ncurator-e2e-user-data-'))
  await mkdir(userDataDir, { recursive: true })
  const launchEnv = buildElectronLaunchEnv(
    userDataDir,
    input.serviceMode,
    input.windowMode,
    input.extraEnv
  )
  const electronApp = await electron.launch({
    executablePath: launch.executablePath,
    args: launch.args,
    cwd: launch.cwd,
    env: launchEnv as Record<string, string>
  })
  const electronProcess = electronApp.process()
  recordLifecycle('electron-process-started', {
    pid: electronProcess?.pid || null
  })
  electronProcess?.stdout?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'log', 'main:stdout', chunk, input.signalSink)
  })
  electronProcess?.stderr?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'error', 'main:stderr', chunk, input.signalSink)
  })
  electronProcess?.on('exit', (code, signal) => {
    recordLifecycle('electron-process-exit', {
      code,
      signal: signal || null
    })
    pushProcessLog(
      consoleEntries,
      code === 0 ? 'log' : 'error',
      'main:exit',
      `code=${String(code)} signal=${String(signal)}`,
      input.signalSink
    )
  })

  const page = await electronApp.firstWindow()
  electronApplicationByPage.set(page, electronApp)
  assertLaunchedWorkbenchApp(page)
  const processInfo = await electronApp.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: app.getPath('exe'),
    resourcesPath: process.resourcesPath,
    version: app.getVersion()
  }))
  if (launch.target === 'package' && !processInfo.isPackaged) {
    throw new Error(
      `Package E2E launched a non-packaged application: ${processInfo.executablePath}`
    )
  }
  if (launch.target === 'source' && processInfo.isPackaged) {
    throw new Error(
      `Source E2E unexpectedly launched a packaged application: ${processInfo.appPath}`
    )
  }
  const appInfo: E2EAppInfo = {
    target: launch.target,
    ...processInfo,
    artifactPath: String(process.env.NCURATOR_E2E_ARTIFACT_PATH || '').trim() || null,
    artifactSha256: String(process.env.NCURATOR_E2E_ARTIFACT_SHA256 || '').trim() || null
  }
  recordLifecycle('electron-app-verified', appInfo)
  if ((input.windowMode || process.env.NCURATOR_E2E_WINDOW_MODE) === 'visible') {
    await focusVisibleElectronWindow(electronApp)
  }
  page.on('close', () => {
    recordLifecycle('page-close')
  })
  page.on('crash', () => {
    recordLifecycle('page-crash')
  })
  electronApp.on('close', () => {
    recordLifecycle('electron-app-close')
  })
  await page.context().tracing.start({
    screenshots: true,
    snapshots: true
  })

  page.on('console', (message) => {
    const entry = {
      ts: new Date().toISOString(),
      level: toConsoleLevel(message),
      text: message.text()
    }
    consoleEntries.push(entry)
    input.signalSink?.onConsole?.(entry)
  })

  await page.waitForLoadState('domcontentloaded')
  assertLaunchedWorkbenchApp(page)
  await installPageObservers(page, input.signalSink)
  await page.evaluate((processId) => {
    const currentWindow = window as E2EWindow
    currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ = processId || undefined
  }, electronProcess?.pid || null)

  return {
    electronApp,
    page,
    userDataDir,
    appInfo,
    collectSignals: async () => {
      let state: E2EObserverState = {
        routeEntries: [],
        ipcInvokeEntries: [],
        aiRunEventEntries: [],
        domEventEntries: []
      }

      if (!page.isClosed()) {
        try {
          state = await page.evaluate(() => {
            const currentWindow = window as E2EWindow
            return (
              currentWindow.__NCURATOR_E2E_OBSERVER__ || {
                routeEntries: [],
                ipcInvokeEntries: [],
                aiRunEventEntries: [],
                domEventEntries: []
              }
            )
          })
        } catch {
          state = {
            routeEntries: [],
            ipcInvokeEntries: [],
            aiRunEventEntries: [],
            domEventEntries: []
          }
        }
      }

      return {
        ...state,
        consoleEntries,
        lifecycleEntries
      }
    },
    close: async (closeInput) => {
      electronApplicationByPage.delete(page)
      recordLifecycle('electron-teardown-started')
      if (!page.isClosed()) {
        try {
          await page.context().tracing.stop({
            path: closeInput.tracePath
          })
        } catch (error) {
          pushProcessLog(
            consoleEntries,
            'warning',
            'trace',
            error instanceof Error ? error.message : String(error),
            input.signalSink
          )
        }
      }
      let gracefulExitRequested = false
      try {
        gracefulExitRequested = await electronApp.evaluate(async ({ app }) => {
          const prepareShutdown = (
            globalThis as typeof globalThis & {
              __NCURATOR_E2E_PREPARE_SHUTDOWN__?: () => Promise<void>
            }
          ).__NCURATOR_E2E_PREPARE_SHUTDOWN__
          if (!prepareShutdown) return false
          await prepareShutdown()
          setTimeout(() => app.exit(0), 0)
          return true
        })
        if (gracefulExitRequested) {
          recordLifecycle('electron-graceful-shutdown-prepared')
        }
      } catch (error) {
        pushProcessLog(
          consoleEntries,
          'warning',
          'prepare-shutdown',
          error instanceof Error ? error.message : String(error),
          input.signalSink
        )
      }
      if (gracefulExitRequested && electronProcess && electronProcess.exitCode === null) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 10_000)
          electronProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
      if (!gracefulExitRequested || (electronProcess && electronProcess.exitCode === null)) {
        try {
          await electronApp.close()
        } catch (error) {
          pushProcessLog(
            consoleEntries,
            'warning',
            'electron-close',
            error instanceof Error ? error.message : String(error),
            input.signalSink
          )
        }
      }
      if (!closeInput.preserveUserData) {
        await rm(userDataDir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200
        })
      }
    }
  }
}
