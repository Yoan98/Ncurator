import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../src/shared/types'
import type { E2EConsoleEntry } from './electronApp'
import type {
  CaseExpectedOutcome,
  CaseLifecycle,
  CaseRetentionTier,
  CaseRunPolicy,
  UiCaseSuite
} from '../core/caseMetadata'

export type UiAssertion = {
  id: string
  pass: boolean
  details?: string
}

export type UiExecutionStatus = 'completed' | 'blocked' | 'failed'
export type UiCaseStatus = 'passed' | 'failed'
export type UiCaseErrorCode = 'none' | 'assertion_failed' | 'runtime_exception'
export type UiExpectedOutcome = CaseExpectedOutcome

export type UiArtifactsReport = {
  screenshots: string[]
  trace?: string
  dom: string[]
  console: string
}

export type UiReportInput = {
  suite: UiCaseSuite
  caseId: string
  startedAt: number
  finishedAt: number
  reportRoot?: string
  executionStatus: UiExecutionStatus
  executionResultCode: string
  assertions: UiAssertion[]
  notes: string[]
  aiRunEvents: AiRunEvent[]
  routeSequence: string[]
  userActionSequence: string[]
  ipcInvokeSequence: string[]
  selectorFailures: string[]
  consoleEntries: E2EConsoleEntry[]
  screenshotRefs: string[]
  traceRef?: string
  domRefs: string[]
  expectedOutcome?: UiExpectedOutcome
  scenarioTags?: readonly string[]
  taskGoal?: string
  description?: string
  requiredFixtures?: readonly string[]
  retentionTier?: CaseRetentionTier
  lifecycle?: CaseLifecycle
  runPolicy?: CaseRunPolicy
  capabilityArea?: string
  sourceFile?: string
  profiles?: readonly string[]
}

const ensureDir = async (target: string): Promise<void> => {
  await mkdir(target, { recursive: true })
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toTimestamp = (ms: number): string => {
  const date = new Date(ms)
  return [
    date.getFullYear(),
    '-',
    pad2(date.getMonth() + 1),
    '-',
    pad2(date.getDate()),
    '_',
    pad2(date.getHours()),
    ':',
    pad2(date.getMinutes()),
    ':',
    pad2(date.getSeconds())
  ].join('')
}

const toJsonLines = <T>(items: T[]): string => items.map((item) => JSON.stringify(item)).join('\n')

const buildMetrics = (input: UiReportInput & { caseStatus: UiCaseStatus; caseErrorCode: UiCaseErrorCode }) => {
  return {
    suite: input.suite,
    caseId: input.caseId,
    runId: input.aiRunEvents[0]?.runId || input.caseId,
    taskId:
      input.aiRunEvents.find((event) => 'taskId' in event && typeof event.taskId === 'string')?.taskId ||
      'ui-case',
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    caseStatus: input.caseStatus,
    caseErrorCode: input.caseErrorCode,
    executionStatus: input.executionStatus,
    executionResultCode: input.executionResultCode,
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
    eventCount: input.aiRunEvents.length,
    toolCallCount: input.aiRunEvents.filter((event) => event.type === 'tool_call_started').length,
    humanStepCount: input.aiRunEvents.filter((event) => event.type === 'human_step').length,
    terminalStepCount: input.aiRunEvents.filter((event) => event.type.startsWith('terminal_step_')).length,
    fileArtifactCount: input.aiRunEvents.filter((event) => event.type === 'file_artifact').length,
    approvalRequiredCount: input.aiRunEvents.filter((event) => event.type === 'approval_required').length,
    approvalApprovedCount: input.aiRunEvents.filter(
      (event) => event.type === 'approval_decision' && event.approved
    ).length,
    approvalDeniedCount: input.aiRunEvents.filter(
      (event) => event.type === 'approval_decision' && !event.approved
    ).length,
    workspaceRequiredCount: input.aiRunEvents.filter((event) => event.type === 'workspace_required')
      .length,
    warningCount: input.consoleEntries.filter((entry) => entry.level === 'warning').length
  }
}

export const writeUiCaseReport = async (input: UiReportInput): Promise<string> => {
  const failedAssertionIds = input.assertions.filter((assertion) => !assertion.pass).map((assertion) => assertion.id)
  const caseStatus: UiCaseStatus = failedAssertionIds.length === 0 ? 'passed' : 'failed'
  const caseErrorCode: UiCaseErrorCode =
    input.executionResultCode === 'runtime_exception'
      ? 'runtime_exception'
      : failedAssertionIds.length === 0
        ? 'none'
        : 'assertion_failed'
  const reportRoot =
    input.reportRoot ||
    path.resolve(
      process.cwd(),
      'tests',
      'report',
      input.suite,
      input.caseId,
      toTimestamp(input.startedAt)
    )
  await ensureDir(reportRoot)

  const assertionsReport = {
    suite: input.suite,
    caseId: input.caseId,
    runId: input.aiRunEvents[0]?.runId || input.caseId,
    taskId:
      input.aiRunEvents.find((event) => 'taskId' in event && typeof event.taskId === 'string')?.taskId ||
      'ui-case',
    caseStatus,
    assertionTotal: input.assertions.length,
    assertionPassed: input.assertions.filter((assertion) => assertion.pass).length,
    assertionFailed: failedAssertionIds.length,
    failedAssertionIds,
    assertions: input.assertions
  }
  const metricsReport = buildMetrics({
    ...input,
    caseStatus,
    caseErrorCode
  })
  const signalsReport = {
    suite: input.suite,
    caseId: input.caseId,
    runId: input.aiRunEvents[0]?.runId || input.caseId,
    taskId:
      input.aiRunEvents.find((event) => 'taskId' in event && typeof event.taskId === 'string')?.taskId ||
      'ui-case',
    toolSequence: input.aiRunEvents
      .filter((event) => event.type === 'tool_call_started')
      .map((event) => event.toolName),
    toolCounts: input.aiRunEvents
      .filter((event) => event.type === 'tool_call_started')
      .reduce<Record<string, number>>((counts, event) => {
        counts[event.toolName] = (counts[event.toolName] || 0) + 1
        return counts
      }, {}),
    toolResultCodeCounts: {},
    stepActionSequence: input.aiRunEvents
      .filter((event) => event.type === 'human_step')
      .map((event) => event.action),
    stepActionCounts: {
      load_skill: 0,
      invoke_tool: 0,
      complete_task: 0,
      block_task: 0
    },
    skillActivationSequence: input.aiRunEvents
      .filter((event) => event.type === 'human_step' && event.skillId)
      .map((event) => event.skillId),
    failedAssertionIds,
    expectedOutcome: input.expectedOutcome,
    description: input.description,
    requiredFixtures: input.requiredFixtures || [],
    retentionTier: input.retentionTier,
    lifecycle: input.lifecycle,
    runPolicy: input.runPolicy,
    capabilityArea: input.capabilityArea,
    sourceFile: input.sourceFile,
    profiles: input.profiles || [],
    scenarioTags: input.scenarioTags || [],
    taskGoal: input.taskGoal,
    artifactOperationCounts: {
      created: input.aiRunEvents.filter(
        (event) => event.type === 'file_artifact' && event.operation === 'created'
      ).length,
      updated: input.aiRunEvents.filter(
        (event) => event.type === 'file_artifact' && event.operation === 'updated'
      ).length
    },
    routeSequence: input.routeSequence,
    userActionSequence: input.userActionSequence,
    ipcInvokeSequence: input.ipcInvokeSequence,
    selectorFailures: input.selectorFailures,
    consoleErrorCount: input.consoleEntries.filter((entry) => entry.level === 'error').length,
    screenshotRefs: input.screenshotRefs,
    traceRef: input.traceRef,
    domRefs: input.domRefs
  }
  const artifactsReport: UiArtifactsReport = {
    screenshots: input.screenshotRefs,
    trace: input.traceRef,
    dom: input.domRefs,
    console: 'console.jsonl'
  }

  await writeFile(path.join(reportRoot, 'events.jsonl'), toJsonLines(input.aiRunEvents), 'utf8')
  await writeFile(
    path.join(reportRoot, 'assertions.json'),
    JSON.stringify(assertionsReport, null, 2),
    'utf8'
  )
  await writeFile(
    path.join(reportRoot, 'metrics.json'),
    JSON.stringify(metricsReport, null, 2),
    'utf8'
  )
  await writeFile(
    path.join(reportRoot, 'signals.json'),
    JSON.stringify(signalsReport, null, 2),
    'utf8'
  )
  await writeFile(
    path.join(reportRoot, 'artifacts.json'),
    JSON.stringify(artifactsReport, null, 2),
    'utf8'
  )
  await writeFile(
    path.join(reportRoot, 'summary.md'),
    [
      `# ${input.caseId}`,
      '',
      `- suite: ${input.suite}`,
      `- caseStatus: ${caseStatus}`,
      `- executionStatus: ${input.executionStatus}`,
      `- executionResultCode: ${input.executionResultCode}`,
      `- assertions: ${assertionsReport.assertionPassed}/${assertionsReport.assertionTotal}`,
      `- expectedOutcome: ${input.expectedOutcome || 'none'}`,
      `- scenarioTags: ${(input.scenarioTags || []).join(', ') || 'none'}`,
      `- taskGoal: ${input.taskGoal || 'none'}`,
      `- routeSequence: ${input.routeSequence.join(' -> ') || 'none'}`,
      `- ipcInvokeSequence: ${input.ipcInvokeSequence.join(' -> ') || 'none'}`,
      `- screenshotRefs: ${input.screenshotRefs.join(', ') || 'none'}`,
      `- traceRef: ${input.traceRef || 'none'}`,
      '',
      '## Notes',
      ...input.notes.map((note) => `- ${note}`)
    ].join('\n'),
    'utf8'
  )
  await writeFile(path.join(reportRoot, 'console.jsonl'), toJsonLines(input.consoleEntries), 'utf8')

  return reportRoot
}
