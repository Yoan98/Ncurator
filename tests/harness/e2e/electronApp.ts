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
import type { AiLlmIoRecord, AiRunEvent, JsonValue } from '../../../src/shared/types'
import {
  prepareDesktopLaunch,
  terminateDesktopProcess
} from '../../../scripts/test/desktop-launch.mjs'

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
  id: string
  ts: string
  event: AiRunEvent
}

export type E2ELlmIoEntry = {
  ts: string
  record: AiLlmIoRecord
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

/** Launch Services does not expose the application's native exit status. */
export const isExpectedMacDesktopTeardownExit = (input: {
  platform: NodeJS.Platform
  lifecycleEntries: readonly E2ELifecycleEntry[]
  testPassed: boolean
}): boolean => {
  if (input.platform !== 'darwin' || !input.testPassed) return false
  const teardownIndex = input.lifecycleEntries.findIndex(
    (entry) => entry.name === 'electron-teardown-started'
  )
  const exitIndex = input.lifecycleEntries.findLastIndex(
    (entry) => entry.name === 'electron-process-exit'
  )
  if (teardownIndex < 0 || exitIndex <= teardownIndex) return false
  if (input.lifecycleEntries.some((entry) => entry.name === 'page-crash')) return false
  if (
    !input.lifecycleEntries
      .slice(teardownIndex, exitIndex)
      .some(
        (entry) =>
          entry.name === 'electron-graceful-shutdown-prepared' ||
          entry.name === 'electron-force-killed'
      )
  )
    return false
  const data = input.lifecycleEntries[exitIndex].data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  return (
    data.code === null &&
    data.signal === null &&
    data.launcherExitCode === 0 &&
    data.exited === true
  )
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

/** Playwright close 挂死后由 harness SIGKILL；测试已通过时不算 teardown 失败。 */
export const isExpectedForceKilledTeardownExit = (input: {
  lifecycleEntries: readonly E2ELifecycleEntry[]
  testPassed: boolean
}): boolean => {
  if (!input.testPassed) return false
  if (!input.lifecycleEntries.some((entry) => entry.name === 'electron-force-killed')) return false

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
  return exitData?.signal === 'SIGKILL'
}

type E2EObserverState = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  llmIoEntries: E2ELlmIoEntry[]
  domEventEntries: E2EDomEventEntry[]
}

type E2EWindow = Window & {
  __NCURATOR_E2E_OBSERVER__?: E2EObserverState
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
  __NCURATOR_E2E_RECORD_AI_RUN_EVENT__?: (entry: E2EAiRunEventEntry) => void
  __NCURATOR_E2E_RECORD_LLM_IO__?: (entry: E2ELlmIoEntry) => void
}

export type E2ERuntimeSignals = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  llmIoEntries: E2ELlmIoEntry[]
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
  close: (input: {
    tracePath: string
    preserveUserData?: boolean
    crash?: boolean
  }) => Promise<void>
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
  pid: number
  cwd: string
  userDataPath: string
  launchMethod: 'source' | 'launch-services' | 'installed-shortcut'
  launchEntry: string
  artifactPath: string | null
  artifactSha256: string | null
}

export type ElectronSignalSink = {
  onAiRunEvent?: (entry: E2EAiRunEventEntry) => void
  onLlmIo?: (entry: E2ELlmIoEntry) => void
  onConsole?: (entry: E2EConsoleEntry) => void
  onLifecycle?: (entry: E2ELifecycleEntry) => void
}

const OUT_MAIN_ENTRY = path.resolve(process.cwd(), 'out', 'main', 'index.js')
const APP_ROOT = process.cwd()
const electronApplicationByPage = new WeakMap<Page, ElectronApplication>()
const exposedObserverPages = new WeakSet<Page>()

export const pasteTextThroughElectronClipboard = async (
  page: Page,
  value: string
): Promise<boolean> => {
  const electronApp = electronApplicationByPage.get(page)
  if (!electronApp) return false
  const pageWindow = await electronApp.browserWindow(page)
  const windowId = await pageWindow.evaluate((window) => window.id)
  await pageWindow.dispose()

  return electronApp.evaluate(
    ({ BrowserWindow, clipboard }, input) => {
      const targetWindow = BrowserWindow.fromId(input.windowId)
      if (!targetWindow || targetWindow.isDestroyed() || targetWindow.webContents.isDestroyed()) {
        return false
      }

      clipboard.writeText(input.text)
      if (clipboard.readText() !== input.text) return false
      targetWindow.webContents.paste()
      return true
    },
    { windowId, text: value }
  )
}

export const queueE2ENativeDialogSelection = async (
  page: Page,
  selection: { kind: 'directory' | 'file'; path: string }
): Promise<void> => {
  const electronApp = electronApplicationByPage.get(page)
  if (!electronApp) throw new Error('E2E native dialog selection requires a launched Electron app')

  await electronApp.evaluate(({ BrowserWindow }, input) => {
    const targetWindows = BrowserWindow.getAllWindows().filter(
      (window) => !window.isDestroyed() && !window.webContents.isDestroyed()
    )
    if (targetWindows.length === 0) {
      throw new Error('E2E native dialog selection could not find the main window')
    }
    const state = globalThis as typeof globalThis & {
      __NCURATOR_E2E_NATIVE_DIALOG_SELECTIONS__?: Map<
        number,
        { kind: 'directory' | 'file'; path: string }
      >
    }
    const selections = state.__NCURATOR_E2E_NATIVE_DIALOG_SELECTIONS__
    if (!(selections instanceof Map)) {
      throw new Error('E2E native dialog selection is unavailable outside the E2E observer')
    }
    // A test can have auxiliary Electron windows. Queue the same one-shot selection for every
    // live renderer so the IPC sender that opens the dialog consumes it.
    for (const window of targetWindows) {
      selections.set(window.webContents.id, input)
    }
  }, selection)
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
  cwd?: string
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
    args: []
    // The desktop launcher determines the working directory, as for users.
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

  // Cursor/agent shells may inject ELECTRON_RUN_AS_NODE=1, which makes the Electron
  // binary behave like Node and reject Chromium launch flags from Playwright.
  delete env.ELECTRON_RUN_AS_NODE

  return env
}

const installPageObservers = async (page: Page, sink?: ElectronSignalSink): Promise<void> => {
  await page.waitForFunction(() => Boolean(window.api))
  if (sink?.onAiRunEvent && !exposedObserverPages.has(page)) {
    await page.exposeFunction(
      '__NCURATOR_E2E_RECORD_AI_RUN_EVENT__',
      (entry: E2EAiRunEventEntry) => {
        sink.onAiRunEvent?.(entry)
      }
    )
  }
  if (sink?.onLlmIo && !exposedObserverPages.has(page)) {
    await page.exposeFunction('__NCURATOR_E2E_RECORD_LLM_IO__', (entry: E2ELlmIoEntry) => {
      sink.onLlmIo?.(entry)
    })
  }
  exposedObserverPages.add(page)

  await page.evaluate(() => {
    const currentWindow = window as E2EWindow & {
      __NCURATOR_E2E_OBSERVER_BOUND__?: boolean
    }
    // framenavigated reinstalls observers after SPA navigations, but the same
    // document keeps prior listeners. Re-binding would double-count every IPC.
    if (currentWindow.__NCURATOR_E2E_OBSERVER_BOUND__ && currentWindow.__NCURATOR_E2E_OBSERVER__) {
      return
    }
    const now = (): string => new Date().toISOString()
    const routeEntries: E2ERouteEntry[] = [{ ts: now(), route: window.location.hash || '#/' }]
    const ipcInvokeEntries: E2EIpcInvokeEntry[] = []
    const aiRunEventEntries: E2EAiRunEventEntry[] = []
    const llmIoEntries: E2ELlmIoEntry[] = []
    const domEventEntries: E2EDomEventEntry[] = []

    currentWindow.__NCURATOR_E2E_OBSERVER__ = {
      routeEntries,
      ipcInvokeEntries,
      aiRunEventEntries,
      llmIoEntries,
      domEventEntries
    }
    currentWindow.__NCURATOR_E2E_OBSERVER_BOUND__ = true

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
        id: crypto.randomUUID(),
        ts: now(),
        event: detail
      }
      currentWindow.__NCURATOR_E2E_OBSERVER__?.aiRunEventEntries.push(entry)
      currentWindow.__NCURATOR_E2E_RECORD_AI_RUN_EVENT__?.(entry)
    })

    window.addEventListener('ncurator-e2e-llm-io', (event) => {
      const detail = (event as CustomEvent<AiLlmIoRecord>).detail
      const entry = {
        ts: now(),
        record: detail
      }
      currentWindow.__NCURATOR_E2E_OBSERVER__?.llmIoEntries.push(entry)
      currentWindow.__NCURATOR_E2E_RECORD_LLM_IO__?.(entry)
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
  prepareUserData?: (userDataDir: string) => Promise<void>
}): Promise<LaunchedElectronApp> => {
  const launch = await resolveElectronLaunch()

  const consoleEntries: E2EConsoleEntry[] = []
  const lifecycleEntries: E2ELifecycleEntry[] = []
  const aiRunEventEntries = new Map<string, E2EAiRunEventEntry>()
  const llmIoEntries = new Map<string, E2ELlmIoEntry>()
  const observerSink: ElectronSignalSink = {
    onAiRunEvent: (entry) => {
      aiRunEventEntries.set(entry.id, entry)
      input.signalSink?.onAiRunEvent?.(entry)
    },
    onLlmIo: (entry) => {
      llmIoEntries.set(entry.record.callId, entry)
      input.signalSink?.onLlmIo?.(entry)
    }
  }
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
  try {
    await input.prepareUserData?.(userDataDir)
  } catch (error) {
    if (!input.userDataDir) {
      await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    }
    throw error
  }
  const launchEnv = buildElectronLaunchEnv(
    userDataDir,
    input.serviceMode,
    input.windowMode,
    input.extraEnv
  )
  const desktopLaunch =
    launch.target === 'package'
      ? await prepareDesktopLaunch({
          executablePath: launch.executablePath,
          entryPath: process.env.NCURATOR_E2E_LAUNCH_ENTRY,
          env: launchEnv
        })
      : undefined
  let electronApp: ElectronApplication
  try {
    electronApp = await electron.launch({
      executablePath: desktopLaunch?.executablePath || launch.executablePath,
      args: launch.args,
      cwd: launch.cwd,
      env: (desktopLaunch?.env || launchEnv) as Record<string, string>,
      timeout: 90_000
    })
  } catch (error) {
    await desktopLaunch?.dispose()
    if (!input.userDataDir) await rm(userDataDir, { recursive: true, force: true })
    throw error
  }
  const electronProcess = electronApp.process()
  let applicationPid = electronProcess?.pid || 0
  electronProcess?.stdout?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'log', 'main:stdout', chunk, input.signalSink)
  })
  electronProcess?.stderr?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'error', 'main:stderr', chunk, input.signalSink)
  })
  electronProcess?.on('exit', (code, signal) => {
    const desktopState = desktopLaunch?.readState()
    recordLifecycle('electron-process-exit', {
      pid: applicationPid,
      code: desktopLaunch ? (desktopState?.exitCode ?? null) : code,
      signal: signal || null,
      ...(desktopLaunch ? { launcherExitCode: code, exited: desktopState?.exited === true } : {})
    })
    pushProcessLog(
      consoleEntries,
      code === 0 ? 'log' : 'error',
      'main:exit',
      `code=${String(code)} signal=${String(signal)}`,
      input.signalSink
    )
  })

  let page: Page
  try {
    page = await electronApp.firstWindow()
  } catch (error) {
    const diagnostics = consoleEntries
      .slice(-20)
      .map((entry) => entry.text)
      .join('\n')
    if (desktopLaunch) await desktopLaunch.dispose()
    else await electronApp.close().catch(() => undefined)
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}${
        diagnostics ? `\nMain process diagnostics:\n${diagnostics}` : ''
      }`
    )
  }
  electronApplicationByPage.set(page, electronApp)
  assertLaunchedWorkbenchApp(page)
  const processInfo = await electronApp.evaluate(({ app }) => ({
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    executablePath: app.getPath('exe'),
    resourcesPath: process.resourcesPath,
    version: app.getVersion(),
    pid: process.pid,
    cwd: process.cwd(),
    userDataPath: app.getPath('userData')
  }))
  applicationPid = processInfo.pid
  const desktopState = desktopLaunch?.readState()
  if (
    launch.target === 'package' &&
    (path.resolve(processInfo.executablePath).toLowerCase() !==
      path.resolve(launch.executablePath).toLowerCase() ||
      path.resolve(processInfo.userDataPath) !== path.resolve(userDataDir) ||
      desktopState?.pid !== applicationPid ||
      (process.platform === 'win32' &&
        path.resolve(processInfo.cwd).toLowerCase() !==
          path.resolve(desktopState?.workingDirectory || '').toLowerCase()))
  ) {
    await desktopLaunch?.dispose()
    throw new Error('Desktop E2E did not connect to the expected isolated application process')
  }
  recordLifecycle('electron-process-started', {
    pid: applicationPid,
    ...(desktopLaunch ? { launcherPid: electronProcess?.pid || null } : {})
  })
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
    launchMethod:
      launch.target === 'source'
        ? 'source'
        : process.platform === 'darwin'
          ? 'launch-services'
          : 'installed-shortcut',
    launchEntry: desktopLaunch?.readState()?.entryPath || launch.executablePath,
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
  await installPageObservers(page, observerSink)
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return
    void installPageObservers(page, observerSink).catch(() => undefined)
  })
  await page.evaluate((processId) => {
    const currentWindow = window as E2EWindow
    currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ = processId || undefined
  }, applicationPid || null)

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
        llmIoEntries: [],
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
                llmIoEntries: [],
                domEventEntries: []
              }
            )
          })
        } catch {
          state = {
            routeEntries: [],
            ipcInvokeEntries: [],
            aiRunEventEntries: [],
            llmIoEntries: [],
            domEventEntries: []
          }
        }
      }

      // Keep observed evidence across Renderer reloads; page-local arrays start afresh.
      // Merge the snapshot too, so collection cannot race a pending exposed callback.
      for (const entry of state.aiRunEventEntries) aiRunEventEntries.set(entry.id, entry)
      for (const entry of state.llmIoEntries || []) llmIoEntries.set(entry.record.callId, entry)
      return {
        ...state,
        aiRunEventEntries: [...aiRunEventEntries.values()],
        llmIoEntries: [...llmIoEntries.values()],
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
      if (closeInput.crash && electronProcess?.pid) {
        // Only terminate the process tree launched by this harness. No production shutdown hooks.
        terminateDesktopProcess(applicationPid)
        recordLifecycle('electron-force-killed')
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 3000)
          electronProcess.once('exit', () => {
            clearTimeout(timer)
            resolve()
          })
        })
        await desktopLaunch?.dispose()
        return
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
          await desktopLaunch?.releaseDebugger()
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
        // app.exit(0) 后主进程偶发因子进程未退出而卡住；只等一小段，不再死等 Playwright close。
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 5_000)
          electronProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
      // 未走 graceful，或 graceful 后仍未退出时：Playwright electronApp.close() 会挂死，跳过直接强杀。
      if (!gracefulExitRequested && electronProcess && electronProcess.exitCode === null) {
        try {
          await Promise.race([
            electronApp.close(),
            new Promise<void>((_, reject) => {
              setTimeout(() => reject(new Error('electronApp.close timed out after 15s')), 15_000)
            })
          ])
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
      // graceful 后仍未退出、或 Playwright close 超时：强制结束，避免 live 门禁卡死
      if (electronProcess && electronProcess.exitCode === null && !electronProcess.killed) {
        try {
          terminateDesktopProcess(applicationPid)
          recordLifecycle('electron-force-killed')
        } catch (error) {
          pushProcessLog(
            consoleEntries,
            'warning',
            'electron-force-kill',
            error instanceof Error ? error.message : String(error),
            input.signalSink
          )
        }
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(resolve, 3_000)
          electronProcess.once('exit', () => {
            clearTimeout(timeout)
            resolve()
          })
        })
      }
      await desktopLaunch?.dispose()
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
