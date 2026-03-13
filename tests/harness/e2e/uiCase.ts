import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { UiAssertion, UiExpectedOutcome } from './reporter'
import { writeUiCaseReport } from './reporter'
import type { LaunchedElectronApp } from './electronApp'
import type { GovernedCaseMetadata, UiCaseSuite } from '../core/caseMetadata'

type CaseArtifacts = {
  reportRoot: string
  screenshotPath: string
  tracePath: string
  domPath: string
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toTimestamp = (ms: number): string => {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}_${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

export const createUiCaseArtifacts = async (
  suite: UiCaseSuite,
  caseId: string,
  startedAt: number
): Promise<CaseArtifacts> => {
  const reportRoot = path.resolve(
    process.cwd(),
    'tests',
    'report',
    suite,
    caseId,
    toTimestamp(startedAt)
  )
  const screenshotPath = path.join(reportRoot, 'screenshots', 'final.png')
  const tracePath = path.join(reportRoot, 'trace', 'trace.zip')
  const domPath = path.join(reportRoot, 'dom', 'final.html')

  await mkdir(path.dirname(screenshotPath), { recursive: true })
  await mkdir(path.dirname(tracePath), { recursive: true })
  await mkdir(path.dirname(domPath), { recursive: true })

  return {
    reportRoot,
    screenshotPath,
    tracePath,
    domPath
  }
}

export const finalizeElectronUiCase = async (input: {
  app: LaunchedElectronApp | null
  suite: UiCaseSuite
  caseId: string
  startedAt: number
  assertions: UiAssertion[]
  notes: string[]
  userActionSequence: string[]
  selectorFailures: string[]
  executionStatus: 'completed' | 'failed'
  executionResultCode: string
  expectedOutcome: UiExpectedOutcome
  scenarioTags: readonly string[]
  taskGoal: string
  caseMetadata: GovernedCaseMetadata
}): Promise<void> => {
  const artifacts = await createUiCaseArtifacts(input.suite, input.caseId, input.startedAt)
  const runtimeSignals = input.app
    ? await input.app.collectSignals()
    : {
        routeSequence: [],
        ipcInvokeSequence: [],
        aiRunEvents: [],
        consoleEntries: []
      }

  if (input.app) {
    await input.app.page.screenshot({
      path: artifacts.screenshotPath,
      fullPage: true
    })
    await writeFile(artifacts.domPath, await input.app.page.content(), 'utf8')
    await input.app.close({
      tracePath: artifacts.tracePath
    })
  }

  await writeUiCaseReport({
    suite: input.suite,
    caseId: input.caseId,
    startedAt: input.startedAt,
    finishedAt: Date.now(),
    reportRoot: artifacts.reportRoot,
    executionStatus: input.executionStatus,
    executionResultCode: input.executionResultCode,
    assertions: input.assertions,
    notes: input.notes,
    aiRunEvents: runtimeSignals.aiRunEvents,
    routeSequence: runtimeSignals.routeSequence,
    userActionSequence: input.userActionSequence,
    ipcInvokeSequence: runtimeSignals.ipcInvokeSequence,
    selectorFailures: input.selectorFailures,
    consoleEntries: runtimeSignals.consoleEntries,
    screenshotRefs: ['screenshots/final.png'],
    traceRef: 'trace/trace.zip',
    domRefs: ['dom/final.html'],
    expectedOutcome: input.caseMetadata?.expectedOutcome || input.expectedOutcome,
    scenarioTags: input.caseMetadata?.scenarioTags || input.scenarioTags,
    taskGoal: input.caseMetadata?.taskGoal || input.taskGoal,
    description: input.caseMetadata?.description,
    requiredFixtures: input.caseMetadata?.requiredFixtures || [],
    retentionTier: input.caseMetadata?.retentionTier,
    lifecycle: input.caseMetadata?.lifecycle,
    runPolicy: input.caseMetadata?.runPolicy,
    capabilityArea: input.caseMetadata?.capabilityArea,
    sourceFile: input.caseMetadata?.sourceFile,
    profiles: input.caseMetadata?.profiles || []
  })
}
