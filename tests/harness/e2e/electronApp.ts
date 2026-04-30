import path from 'node:path'
import os from 'node:os'
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

type E2EObserverState = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  domEventEntries: E2EDomEventEntry[]
}

type E2EWindow = Window & {
  __NCURATOR_E2E_OBSERVER__?: E2EObserverState
}

export type E2ERuntimeSignals = {
  routeEntries: E2ERouteEntry[]
  ipcInvokeEntries: E2EIpcInvokeEntry[]
  aiRunEventEntries: E2EAiRunEventEntry[]
  domEventEntries: E2EDomEventEntry[]
  consoleEntries: E2EConsoleEntry[]
}

export type LaunchedElectronApp = {
  electronApp: ElectronApplication
  page: Page
  collectSignals: () => Promise<E2ERuntimeSignals>
  close: (input: { tracePath: string }) => Promise<void>
}

const OUT_MAIN_ENTRY = path.resolve(process.cwd(), 'out', 'main', 'index.js')

const toConsoleLevel = (message: ConsoleMessage): E2EConsoleLevel => {
  if (message.type() === 'error') return 'error'
  if (message.type() === 'warning') return 'warning'
  return 'log'
}

const ensureBuiltAppExists = async (): Promise<void> => {
  await access(OUT_MAIN_ENTRY)
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

export const launchElectronApp = async (): Promise<LaunchedElectronApp> => {
  await ensureBuiltAppExists()

  const consoleEntries: E2EConsoleEntry[] = []
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'ncurator-e2e-user-data-'))
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NCURATOR_E2E_MODE: '1',
      NCURATOR_E2E_WINDOW_MODE: process.env.NCURATOR_E2E_WINDOW_MODE || 'background',
      NCURATOR_USER_DATA_PATH: userDataDir
    }
  })

  const page = await electronApp.firstWindow()
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
        consoleEntries
      }
    },
    close: async (input) => {
      await page.context().tracing.stop({
        path: input.tracePath
      })
      await electronApp.close()
      await rm(userDataDir, { recursive: true, force: true })
    }
  }
}
