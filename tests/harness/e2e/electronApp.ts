import path from 'node:path'
import os from 'node:os'
import { createServer } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
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

type E2EObserverState = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  domEventEntries: E2EDomEventEntry[]
}

type E2EWindow = Window & {
  __NCURATOR_E2E_OBSERVER__?: E2EObserverState
  __NCURATOR_E2E_ELECTRON_PROCESS_ID__?: number
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
  collectSignals: () => Promise<E2ERuntimeSignals>
  close: (input: { tracePath: string }) => Promise<void>
}

export type ElectronLaunchMode = 'fixture' | 'real'
export type ElectronWindowMode = 'background' | 'visible'

const OUT_MAIN_ENTRY = path.resolve(process.cwd(), 'out', 'main', 'index.js')

const toConsoleLevel = (message: ConsoleMessage): E2EConsoleLevel => {
  if (message.type() === 'error') return 'error'
  if (message.type() === 'warning') return 'warning'
  return 'log'
}

const pushProcessLog = (
  entries: E2EConsoleEntry[],
  level: E2EConsoleLevel,
  source: string,
  chunk: Buffer | string
): void => {
  const text = String(chunk)
  if (!text.trim()) return
  entries.push({
    ts: new Date().toISOString(),
    level,
    text: `[${source}] ${text.trim()}`
  })
}

const ensureBuiltAppExists = async (): Promise<void> => {
  await access(OUT_MAIN_ENTRY)
}

const allocateFreePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    throw new Error('failed to allocate free port for electron e2e')
  }
  const port = address.port
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
  return port
}

const buildElectronLaunchEnv = (
  userDataDir: string,
  launchMode: ElectronLaunchMode,
  remoteDebuggingPort: number,
  windowMode?: ElectronWindowMode
): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('npm_')) continue
    if (value !== undefined) {
      env[key] = value
    }
  }

  if (launchMode === 'fixture') {
    env.NCURATOR_E2E_MODE = '1'
    delete env.NCURATOR_E2E_OBSERVER
  } else {
    delete env.NCURATOR_E2E_MODE
    env.NCURATOR_E2E_OBSERVER = '1'
    env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE =
      process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE || '1'
    env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH =
      process.env.NCURATOR_WORKSPACE_KNOWLEDGE_CACHE_PATH ||
      path.resolve(process.cwd(), 'tests', '.cache', 'workspace-knowledge')
  }
  env.NCURATOR_E2E_WINDOW_MODE =
    windowMode || process.env.NCURATOR_E2E_WINDOW_MODE || 'background'
  env.NCURATOR_USER_DATA_PATH = userDataDir
  env.NCURATOR_EMBEDDED_BROWSER_REMOTE_DEBUGGING_PORT = String(remoteDebuggingPort)

  return env
}

const installPageObservers = async (page: Page): Promise<void> => {
  await page.waitForFunction(() => Boolean(window.api))

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
      currentWindow.__NCURATOR_E2E_OBSERVER__?.aiRunEventEntries.push({
        ts: now(),
        event: detail
      })
    })

    window.addEventListener('check-llm-config', () => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.domEventEntries.push({
        ts: now(),
        name: 'check-llm-config'
      })
    })
  })
}

export const launchElectronApp = async (
  input: { launchMode?: ElectronLaunchMode; windowMode?: ElectronWindowMode } = {}
): Promise<LaunchedElectronApp> => {
  await ensureBuiltAppExists()

  const consoleEntries: E2EConsoleEntry[] = []
  const lifecycleEntries: E2ELifecycleEntry[] = []
  const recordLifecycle = (name: string, data?: JsonValue): void => {
    lifecycleEntries.push({
      ts: new Date().toISOString(),
      name,
      data
    })
  }
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ncurator-e2e-user-data-'))
  const remoteDebuggingPort = await allocateFreePort()
  const launchEnv = buildElectronLaunchEnv(
    userDataDir,
    input.launchMode || 'fixture',
    remoteDebuggingPort,
    input.windowMode
  )
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: process.cwd(),
    env: launchEnv
  })
  const electronProcess = electronApp.process()
  recordLifecycle('electron-process-started', {
    pid: electronProcess?.pid || null
  })
  electronProcess?.stdout?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'log', 'main:stdout', chunk)
  })
  electronProcess?.stderr?.on('data', (chunk) => {
    pushProcessLog(consoleEntries, 'error', 'main:stderr', chunk)
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
      `code=${String(code)} signal=${String(signal)}`
    )
  })

  const page = await electronApp.firstWindow()
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
    consoleEntries.push({
      ts: new Date().toISOString(),
      level: toConsoleLevel(message),
      text: message.text()
    })
  })

  await page.waitForLoadState('domcontentloaded')
  await installPageObservers(page)
  await page.evaluate((processId) => {
    const currentWindow = window as E2EWindow
    currentWindow.__NCURATOR_E2E_ELECTRON_PROCESS_ID__ = processId || undefined
  }, electronProcess?.pid || null)

  return {
    electronApp,
    page,
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
    close: async (input) => {
      if (!page.isClosed()) {
        try {
          await page.context().tracing.stop({
            path: input.tracePath
          })
        } catch (error) {
          pushProcessLog(consoleEntries, 'warning', 'trace', error instanceof Error ? error.message : String(error))
        }
      }
      try {
        await electronApp.close()
      } catch (error) {
        pushProcessLog(consoleEntries, 'warning', 'electron-close', error instanceof Error ? error.message : String(error))
      }
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}
