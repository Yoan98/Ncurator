import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DesktopApiMock } from './apiMock'
import {
  writeUiCaseReport,
  type UiAssertion,
  type UiExpectedOutcome
} from '../e2e/reporter'

type RendererConsoleEntry = {
  level: 'log' | 'warning' | 'error'
  text: string
}

type RendererCaseInput = {
  suite: string
  caseId: string
  apiMock: DesktopApiMock
  userActionSequence: string[]
  selectorFailures: string[]
  assertions: UiAssertion[]
  notes: string[]
  route?: string
  expectedOutcome?: UiExpectedOutcome
  scenarioTags?: string[]
  taskGoal?: string
  screenshotRefs?: string[]
  traceRef?: string
  domRefs?: string[]
  body: () => Promise<void>
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toTimestamp = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const runRendererCase = async (input: RendererCaseInput): Promise<void> => {
  const startedAt = Date.now()
  const consoleEntries: RendererConsoleEntry[] = []
  const originalError = console.error
  const originalWarn = console.warn
  let runtimeError: Error | null = null

  console.error = (...args: Array<string | number | boolean | null | undefined | object>) => {
    consoleEntries.push({
      level: 'error',
      text: args.map((item) => String(item)).join(' ')
    })
    originalError(...args)
  }

  console.warn = (...args: Array<string | number | boolean | null | undefined | object>) => {
    consoleEntries.push({
      level: 'warning',
      text: args.map((item) => String(item)).join(' ')
    })
    originalWarn(...args)
  }

  try {
    await input.body()
  } catch (error) {
    runtimeError = error instanceof Error ? error : new Error(String(error))
    input.notes.push(runtimeError.message)
    input.assertions.push({
      id: `${input.caseId}-runtime`,
      pass: false,
      details: runtimeError.message
    })
  } finally {
    console.error = originalError
    console.warn = originalWarn

    const reportRoot = path.resolve(
      process.cwd(),
      'tests',
      'report',
      input.suite,
      input.caseId,
      toTimestamp(startedAt)
    )
    const domPath = path.join(reportRoot, 'dom', 'final.html')
    await mkdir(path.dirname(domPath), { recursive: true })
    await writeFile(domPath, document.documentElement.outerHTML, 'utf8')

    await writeUiCaseReport({
      suite: input.suite,
      caseId: input.caseId,
      startedAt,
      finishedAt: Date.now(),
      reportRoot,
      executionStatus: runtimeError ? 'failed' : 'completed',
      executionResultCode: runtimeError ? 'runtime_exception' : 'ok',
      assertions: input.assertions,
      notes: input.notes,
      aiRunEvents: input.apiMock.emittedAiRunEvents,
      routeSequence: [input.route || window.location.hash || '#/'],
      userActionSequence: input.userActionSequence,
      ipcInvokeSequence: input.apiMock.callSequence,
      selectorFailures: input.selectorFailures,
      consoleEntries,
      screenshotRefs: input.screenshotRefs || [],
      traceRef: input.traceRef,
      domRefs: input.domRefs || ['dom/final.html'],
      expectedOutcome: input.expectedOutcome,
      scenarioTags: input.scenarioTags,
      taskGoal: input.taskGoal
    })
  }

  if (runtimeError) {
    throw runtimeError
  }
}
