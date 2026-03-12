import path from 'node:path'
import { access } from 'node:fs/promises'
import electronPath from 'electron'
import {
  _electron as electron,
  type ConsoleMessage,
  type ElectronApplication,
  type Page
} from 'playwright'
import type { AiRunEvent } from '../../../src/shared/types'

type E2EConsoleLevel = 'log' | 'warning' | 'error'

export type E2EConsoleEntry = {
  level: E2EConsoleLevel
  text: string
}

type E2EObserverState = {
  routeSequence: string[]
  ipcInvokeSequence: string[]
  aiRunEvents: AiRunEvent[]
}

type E2EWindow = Window & {
  __NCURATOR_E2E_OBSERVER__?: E2EObserverState
}

export type E2ERuntimeSignals = {
  routeSequence: string[]
  ipcInvokeSequence: string[]
  aiRunEvents: AiRunEvent[]
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
    const routeSequence = [window.location.hash || '#/']
    const ipcInvokeSequence: string[] = []
    const aiRunEvents: AiRunEvent[] = []

    currentWindow.__NCURATOR_E2E_OBSERVER__ = {
      routeSequence,
      ipcInvokeSequence,
      aiRunEvents
    }

    window.addEventListener('hashchange', () => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.routeSequence.push(window.location.hash || '#/')
    })

    const originalAiRunStart = window.api.aiRunStart.bind(window.api)
    window.api.aiRunStart = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('aiRunStart')
      return originalAiRunStart(payload)
    }

    const originalAiRunApprovalDecide = window.api.aiRunApprovalDecide.bind(window.api)
    window.api.aiRunApprovalDecide = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('aiRunApprovalDecide')
      return originalAiRunApprovalDecide(payload)
    }

    const originalSourceScopeList = window.api.sourceScopeList.bind(window.api)
    window.api.sourceScopeList = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('sourceScopeList')
      return originalSourceScopeList(payload)
    }

    const originalDraftReviewSetDecision = window.api.draftReviewSetDecision.bind(window.api)
    window.api.draftReviewSetDecision = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('draftReviewSetDecision')
      return originalDraftReviewSetDecision(payload)
    }

    const originalDraftReviewValidate = window.api.draftReviewValidate.bind(window.api)
    window.api.draftReviewValidate = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('draftReviewValidate')
      return originalDraftReviewValidate(payload)
    }

    const originalDraftReviewCommit = window.api.draftReviewCommit.bind(window.api)
    window.api.draftReviewCommit = (payload) => {
      currentWindow.__NCURATOR_E2E_OBSERVER__?.ipcInvokeSequence.push('draftReviewCommit')
      return originalDraftReviewCommit(payload)
    }

    const originalOnAiRunEvent = window.api.onAiRunEvent.bind(window.api)
    window.api.onAiRunEvent = (cb) => {
      originalOnAiRunEvent((event) => {
        currentWindow.__NCURATOR_E2E_OBSERVER__?.aiRunEvents.push(event)
        cb(event)
      })
    }
  })
}

export const launchElectronApp = async (): Promise<LaunchedElectronApp> => {
  await ensureBuiltAppExists()

  const consoleEntries: E2EConsoleEntry[] = []
  const electronApp = await electron.launch({
    executablePath: electronPath,
    args: ['.'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NCURATOR_E2E_MODE: '1'
    }
  })

  const page = await electronApp.firstWindow()
  await page.context().tracing.start({
    screenshots: true,
    snapshots: true
  })

  page.on('console', (message) => {
    consoleEntries.push({
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
      const state = await page.evaluate(() => {
        const currentWindow = window as E2EWindow
        return (
          currentWindow.__NCURATOR_E2E_OBSERVER__ || {
            routeSequence: [],
            ipcInvokeSequence: [],
            aiRunEvents: []
          }
        )
      })

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
    }
  }
}
