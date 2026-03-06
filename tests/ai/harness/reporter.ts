import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  HUMAN_STEP_ACTIONS,
  type AiRunEvent,
  type IpcJsonValue,
  type RuntimeSkillId
} from '../../../src/shared/types'
import type {
  ArtifactOperationCounts,
  CaseAssertionsReport,
  CaseMetricsReport,
  CaseReportInput,
  CaseRuntimeMetrics,
  CaseSignalsReport,
  StepActionCounts,
  ToolCounts,
  ToolResultCodeCounts
} from './types'

const ensureDir = async (target: string): Promise<void> => {
  await mkdir(target, { recursive: true })
}

const pad2 = (value: number): string => String(value).padStart(2, '0')

const toTimestamp = (ms: number): string => {
  const date = new Date(ms)
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  return `${year}-${month}-${day}_${hour}:${minute}:${second}`
}

const toJsonLines = (events: AiRunEvent[]): string => {
  return events.map((event) => JSON.stringify(event)).join('\n')
}

const isJsonRecord = (value: IpcJsonValue): value is Record<string, IpcJsonValue> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isStringArray = (value: IpcJsonValue | undefined): value is string[] => {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const incrementCount = (counts: Record<string, number>, key: string): void => {
  counts[key] = (counts[key] || 0) + 1
}

const incrementNestedCount = (
  counts: ToolResultCodeCounts,
  toolName: string,
  resultCode: string
): void => {
  const current = counts[toolName] || {}
  current[resultCode] = (current[resultCode] || 0) + 1
  counts[toolName] = current
}

const extractToolResultCode = (event: Extract<AiRunEvent, { type: 'tool_call_result' }>): string => {
  if (isJsonRecord(event.outputPreview)) {
    const code = event.outputPreview.code
    if (typeof code === 'string' && code.trim()) return code
  }
  if (event.error) return 'error'
  return 'unknown'
}

const extractWarnings = (event: Extract<AiRunEvent, { type: 'tool_call_result' }>): string[] => {
  if (!isJsonRecord(event.outputPreview)) return []
  const warnings = event.outputPreview.warnings
  return isStringArray(warnings) ? warnings : []
}

const inspectEvents = (events: AiRunEvent[]) => {
  const toolSequence: string[] = []
  const toolCounts: ToolCounts = {}
  const toolResultCodeCounts: ToolResultCodeCounts = {}
  const stepActionSequence: CaseSignalsReport['stepActionSequence'] = []
  const stepActionCounts = HUMAN_STEP_ACTIONS.reduce<StepActionCounts>(
    (counts, action) => ({ ...counts, [action]: 0 }),
    {
      load_skill: 0,
      invoke_tool: 0,
      complete_task: 0,
      block_task: 0
    }
  )
  const skillActivationSequence: RuntimeSkillId[] = []
  const artifactOperationCounts: ArtifactOperationCounts = {
    created: 0,
    updated: 0
  }
  let warningCount = 0
  let approvalRequiredCount = 0
  let approvalApprovedCount = 0
  let approvalDeniedCount = 0
  let workspaceRequiredCount = 0
  let finalHumanAction: CaseSignalsReport['finalHumanAction']

  for (const event of events) {
    if (event.type === 'tool_call_started') {
      toolSequence.push(event.toolName)
      incrementCount(toolCounts, event.toolName)
      continue
    }

    if (event.type === 'tool_call_result') {
      incrementNestedCount(toolResultCodeCounts, event.toolName, extractToolResultCode(event))
      warningCount += extractWarnings(event).length
      continue
    }

    if (event.type === 'file_artifact') {
      artifactOperationCounts[event.operation] += 1
      continue
    }

    if (event.type === 'approval_required') {
      approvalRequiredCount += 1
      continue
    }

    if (event.type === 'approval_decision') {
      if (event.approved) approvalApprovedCount += 1
      else approvalDeniedCount += 1
      continue
    }

    if (event.type === 'workspace_required') {
      workspaceRequiredCount += 1
      continue
    }

    if (event.type === 'human_step') {
      stepActionSequence.push(event.action)
      stepActionCounts[event.action] += 1
      if (event.action === 'load_skill' && event.skillId) {
        skillActivationSequence.push(event.skillId)
      }
      finalHumanAction = event.action
    }
  }

  return {
    toolSequence,
    toolCounts,
    toolResultCodeCounts,
    stepActionSequence,
    stepActionCounts,
    skillActivationSequence,
    artifactOperationCounts,
    warningCount,
    approvalRequiredCount,
    approvalApprovedCount,
    approvalDeniedCount,
    workspaceRequiredCount,
    finalHumanAction
  }
}

const resolveFinalHumanAction = (input: {
  suite: CaseReportInput['suite']
  observedAction: CaseSignalsReport['finalHumanAction']
  executionStatus: CaseReportInput['execution']['status']
}): CaseSignalsReport['finalHumanAction'] => {
  if (input.suite !== 'human-live') return input.observedAction
  if (input.executionStatus === 'completed') return 'complete_task'
  if (input.executionStatus === 'blocked') return 'block_task'
  return input.observedAction
}

const buildMetrics = (input: { report: CaseReportInput }): CaseRuntimeMetrics => {
  const events = input.report.events
  const inspected = inspectEvents(events)
  return {
    durationMs: Math.max(0, input.report.finishedAt - input.report.startedAt),
    eventCount: events.length,
    toolCallCount: events.filter((event) => event.type === 'tool_call_started').length,
    humanStepCount: events.filter((event) => event.type === 'human_step').length,
    terminalStepCount: events.filter((event) => event.type.startsWith('terminal_step_')).length,
    fileArtifactCount: events.filter((event) => event.type === 'file_artifact').length,
    approvalRequiredCount: inspected.approvalRequiredCount,
    approvalApprovedCount: inspected.approvalApprovedCount,
    approvalDeniedCount: inspected.approvalDeniedCount,
    workspaceRequiredCount: inspected.workspaceRequiredCount,
    warningCount: inspected.warningCount
  }
}

const buildAssertionsReport = (input: CaseReportInput): CaseAssertionsReport => {
  const assertionTotal = input.assertions.length
  const failedAssertionIds = input.assertions.filter((item) => !item.pass).map((item) => item.id)
  const assertionFailed = failedAssertionIds.length
  return {
    suite: input.suite,
    caseId: input.caseId,
    runId: input.runId,
    taskId: input.taskId,
    caseStatus: input.caseStatus,
    assertionTotal,
    assertionPassed: assertionTotal - assertionFailed,
    assertionFailed,
    failedAssertionIds,
    assertions: input.assertions
  }
}

const buildMetricsReport = (input: {
  report: CaseReportInput
  metrics: CaseRuntimeMetrics
}): CaseMetricsReport => {
  return {
    suite: input.report.suite,
    caseId: input.report.caseId,
    runId: input.report.runId,
    taskId: input.report.taskId,
    startedAt: input.report.startedAt,
    finishedAt: input.report.finishedAt,
    caseStatus: input.report.caseStatus,
    caseErrorCode: input.report.caseErrorCode,
    executionStatus: input.report.execution.status,
    executionResultCode: input.report.execution.resultCode,
    ...input.metrics
  }
}

const buildSignalsReport = (input: {
  report: CaseReportInput
  assertions: CaseAssertionsReport
}): CaseSignalsReport => {
  const inspected = inspectEvents(input.report.events)
  return {
    suite: input.report.suite,
    caseId: input.report.caseId,
    runId: input.report.runId,
    taskId: input.report.taskId,
    expectedOutcome: input.report.signalOverrides?.expectedOutcome,
    scenarioTags: input.report.signalOverrides?.scenarioTags || [],
    toolSequence: inspected.toolSequence,
    toolCounts: inspected.toolCounts,
    toolResultCodeCounts: inspected.toolResultCodeCounts,
    stepActionSequence: inspected.stepActionSequence,
    stepActionCounts: inspected.stepActionCounts,
    skillActivationSequence: inspected.skillActivationSequence,
    failedAssertionIds: input.assertions.failedAssertionIds,
    artifactOperationCounts: inspected.artifactOperationCounts,
    finalHumanAction: resolveFinalHumanAction({
      suite: input.report.suite,
      observedAction: inspected.finalHumanAction,
      executionStatus: input.report.execution.status
    }),
    executionSummary: input.report.execution.summary
  }
}

const buildSummaryMarkdown = (input: {
  report: CaseReportInput
  assertions: CaseAssertionsReport
  metrics: CaseMetricsReport
  signals: CaseSignalsReport
}): string => {
  const { report, assertions, metrics, signals } = input
  const toolSequenceText =
    signals.toolSequence.length > 0 ? signals.toolSequence.join(' -> ') : 'none'
  const skillActivationText =
    signals.skillActivationSequence.length > 0 ? signals.skillActivationSequence.join(' -> ') : 'none'
  const failedAssertionText =
    assertions.failedAssertionIds.length > 0 ? assertions.failedAssertionIds.join(', ') : 'none'
  const scenarioTagText = signals.scenarioTags.length > 0 ? signals.scenarioTags.join(', ') : 'none'
  return [
    `# ${report.caseId}`,
    '',
    `- suite: ${report.suite}`,
    `- caseStatus: ${report.caseStatus}`,
    `- caseErrorCode: ${report.caseErrorCode}`,
    `- executionStatus: ${report.execution.status}`,
    `- executionResultCode: ${report.execution.resultCode}`,
    `- runId: ${report.runId}`,
    `- taskId: ${report.taskId}`,
    `- durationMs: ${metrics.durationMs}`,
    `- assertions: ${assertions.assertionPassed}/${assertions.assertionTotal}`,
    `- failedAssertionIds: ${failedAssertionText}`,
    `- toolSequence: ${toolSequenceText}`,
    `- skillActivationSequence: ${skillActivationText}`,
    `- scenarioTags: ${scenarioTagText}`,
    `- approvalDeniedCount: ${metrics.approvalDeniedCount}`,
    `- warningCount: ${metrics.warningCount}`,
    '',
    '## Notes',
    ...report.notes.map((note) => `- ${note}`)
  ].join('\n')
}

export const writeCaseReport = async (input: CaseReportInput): Promise<string> => {
  const reportRoot = path.resolve(
    process.cwd(),
    'tests',
    'report',
    input.suite,
    input.caseId,
    toTimestamp(input.startedAt)
  )
  await ensureDir(reportRoot)

  const metrics = buildMetrics({ report: input })
  const assertions = buildAssertionsReport(input)
  const metricsReport = buildMetricsReport({
    report: input,
    metrics
  })
  const signals = buildSignalsReport({
    report: input,
    assertions
  })

  const assertionsPath = path.join(reportRoot, 'assertions.json')
  const eventsPath = path.join(reportRoot, 'events.jsonl')
  const metricsPath = path.join(reportRoot, 'metrics.json')
  const signalsPath = path.join(reportRoot, 'signals.json')
  const summaryPath = path.join(reportRoot, 'summary.md')

  await writeFile(eventsPath, toJsonLines(input.events), 'utf8')
  await writeFile(assertionsPath, JSON.stringify(assertions, null, 2), 'utf8')
  await writeFile(metricsPath, JSON.stringify(metricsReport, null, 2), 'utf8')
  await writeFile(signalsPath, JSON.stringify(signals, null, 2), 'utf8')
  await writeFile(
    summaryPath,
    buildSummaryMarkdown({
      report: input,
      assertions,
      metrics: metricsReport,
      signals
    }),
    'utf8'
  )

  return reportRoot
}
