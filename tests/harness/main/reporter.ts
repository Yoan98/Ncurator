import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { HUMAN_STEP_ACTIONS } from '../../../src/shared/constants'
import {
  type AiRunEvent,
  type AiRunEventStage,
  type IpcJsonValue,
  type RuntimeSkillId
} from '../../../src/shared/types'
import type {
  ArtifactOperationCounts,
  CaseAssertionsReport,
  CaseMetricsReport,
  CaseQualityGrade,
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

const toJsonObjectKeys = (value: CaseReportInput['execution']['resultData']): string[] => {
  if (!value) return []
  return Object.keys(value).sort()
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

    const ok = event.outputPreview.ok
    if (ok === true) return 'ok'
    if (ok === false) return event.error ? 'error' : 'failed'
  }

  if (Array.isArray(event.outputPreview)) {
    return event.error ? 'error' : 'ok'
  }

  if (event.error) return 'error'
  return 'ok'
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
  const deliveryTaskIds: string[] = []
  const deliverySectionCounts: Record<string, number> = {}
  let warningCount = 0
  let approvalRequiredCount = 0
  let approvalApprovedCount = 0
  let approvalDeniedCount = 0
  let workspaceRequiredCount = 0
  let toolErrorCount = 0
  let repeatedToolCallCount = 0
  let taskDeliveryCount = 0
  let synthesisTriggered = false
  let finalDeliverySource: CaseSignalsReport['finalDeliverySource'] = 'none'
  let finalHumanAction: CaseSignalsReport['finalHumanAction']
  let firstFailureStage: AiRunEventStage | undefined
  let previousToolName: string | undefined

  for (const event of events) {
    if (event.type === 'tool_call_started') {
      toolSequence.push(event.toolName)
      incrementCount(toolCounts, event.toolName)
      if (previousToolName === event.toolName) {
        repeatedToolCallCount += 1
      }
      previousToolName = event.toolName
      continue
    }

    if (event.type === 'tool_call_result') {
      const resultCode = extractToolResultCode(event)
      incrementNestedCount(toolResultCodeCounts, event.toolName, resultCode)
      warningCount += extractWarnings(event).length
      if (resultCode !== 'ok') {
        toolErrorCount += 1
        firstFailureStage ||= event.stage
      }
      continue
    }

    if (event.type === 'file_artifact') {
      artifactOperationCounts[event.operation] += 1
      continue
    }

    if (event.type === 'task_delivery_ready') {
      taskDeliveryCount += 1
      deliveryTaskIds.push(event.taskId)
      const sections = String(event.deliveryMarkdown || '').match(/^##\s+(.+)$/gm) || []
      sections.forEach((section) => {
        const normalized = section.replace(/^##\s+/, '').trim()
        if (!normalized) return
        deliverySectionCounts[normalized] = (deliverySectionCounts[normalized] || 0) + 1
      })
      if (event.taskId === 'direct-human') finalDeliverySource = 'direct_human'
      if (event.taskId === 'synthesis-human') finalDeliverySource = 'synthesis_human'
      continue
    }

    if (event.type === 'approval_required') {
      approvalRequiredCount += 1
      continue
    }

    if (event.type === 'approval_decision') {
      if (event.approved) approvalApprovedCount += 1
      else {
        approvalDeniedCount += 1
        firstFailureStage ||= event.stage
      }
      continue
    }

    if (event.type === 'workspace_required') {
      workspaceRequiredCount += 1
      firstFailureStage ||= event.stage
      continue
    }

    if (event.type === 'human_step') {
      stepActionSequence.push(event.action)
      stepActionCounts[event.action] += 1
      if (event.action === 'load_skill' && event.skillId) {
        skillActivationSequence.push(event.skillId)
      }
      if (event.resultStatus === 'error' || event.resultStatus === 'blocked') {
        firstFailureStage ||= event.stage
      }
      finalHumanAction = event.action
      continue
    }

    if (
      (event.type === 'task_started' || event.type === 'task_completed' || event.type === 'task_result') &&
      event.taskId === 'synthesis-human'
    ) {
      synthesisTriggered = true
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
    taskDeliveryCount,
    deliveryTaskIds,
    deliverySectionCounts,
    synthesisTriggered,
    finalDeliverySource,
    warningCount,
    approvalRequiredCount,
    approvalApprovedCount,
    approvalDeniedCount,
    workspaceRequiredCount,
    toolErrorCount,
    repeatedToolCallCount,
    firstFailureStage,
    finalHumanAction
  }
}

const resolveQualityGrade = (input: {
  suite: CaseReportInput['suite']
  caseErrorCode: CaseReportInput['caseErrorCode']
  executionStatus: CaseReportInput['execution']['status']
  expectedOutcome?: CaseSignalsReport['expectedOutcome']
  toolErrorCount: number
  repeatedToolCallCount: number
  stepBudgetUsage?: number
}): CaseQualityGrade => {
  if (input.suite !== 'main-ai-human') return 'unknown'
  if (
    input.caseErrorCode === 'fixture_missing' ||
    input.caseErrorCode === 'live_config_missing' ||
    input.executionStatus === 'not_run'
  ) {
    return 'harness_fail'
  }
  if (input.expectedOutcome === 'blocked') {
    return input.executionStatus === 'blocked' ? 'expected_block' : 'unknown'
  }
  if (input.executionStatus === 'blocked') return 'unexpected_block'
  if (input.executionStatus !== 'completed') return 'unknown'
  if (
    input.toolErrorCount === 0 &&
    input.repeatedToolCallCount === 0 &&
    (input.stepBudgetUsage === undefined || input.stepBudgetUsage <= 0.75)
  ) {
    return 'hard_pass'
  }
  return 'soft_pass'
}

const resolveFinalHumanAction = (input: {
  suite: CaseReportInput['suite']
  observedAction: CaseSignalsReport['finalHumanAction']
  executionStatus: CaseReportInput['execution']['status']
}): CaseSignalsReport['finalHumanAction'] => {
  if (input.suite !== 'main-ai-human') return input.observedAction
  if (input.executionStatus === 'completed') return 'complete_task'
  if (input.executionStatus === 'blocked') return 'block_task'
  return input.observedAction
}

const buildMetrics = (input: { report: CaseReportInput }): CaseRuntimeMetrics => {
  const events = input.report.events
  const inspected = inspectEvents(events)
  const humanStepCount = events.filter((event) => event.type === 'human_step').length
  const maxSteps = input.report.signalOverrides?.maxSteps
  const stepBudgetUsage =
    input.report.suite === 'main-ai-human' && maxSteps && maxSteps > 0
      ? Number((humanStepCount / maxSteps).toFixed(4))
      : undefined
  const recoveryAfterErrorCount =
    input.report.execution.status === 'completed' ? inspected.toolErrorCount : 0
  const qualityGrade = resolveQualityGrade({
    suite: input.report.suite,
    caseErrorCode: input.report.caseErrorCode,
    executionStatus: input.report.execution.status,
    expectedOutcome: input.report.signalOverrides?.expectedOutcome,
    toolErrorCount: inspected.toolErrorCount,
    repeatedToolCallCount: inspected.repeatedToolCallCount,
    stepBudgetUsage
  })
  return {
    durationMs: Math.max(0, input.report.finishedAt - input.report.startedAt),
    eventCount: events.length,
    toolCallCount: events.filter((event) => event.type === 'tool_call_started').length,
    humanStepCount,
    terminalStepCount: events.filter((event) => event.type.startsWith('terminal_step_')).length,
    fileArtifactCount: events.filter((event) => event.type === 'file_artifact').length,
    taskDeliveryCount: inspected.taskDeliveryCount,
    approvalRequiredCount: inspected.approvalRequiredCount,
    approvalApprovedCount: inspected.approvalApprovedCount,
    approvalDeniedCount: inspected.approvalDeniedCount,
    workspaceRequiredCount: inspected.workspaceRequiredCount,
    warningCount: inspected.warningCount,
    toolErrorCount: inspected.toolErrorCount,
    recoveryAfterErrorCount,
    repeatedToolCallCount: inspected.repeatedToolCallCount,
    stepBudgetUsage,
    qualityGrade,
    finalDeliverySource: inspected.finalDeliverySource
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
    description: input.report.signalOverrides?.description,
    taskGoal: input.report.signalOverrides?.taskGoal,
    maxSteps: input.report.signalOverrides?.maxSteps,
    approvalPolicy: input.report.signalOverrides?.approvalPolicy,
    modelName: input.report.signalOverrides?.modelName,
    requiredFixtures: input.report.signalOverrides?.requiredFixtures || [],
    retentionTier: input.report.signalOverrides?.retentionTier,
    lifecycle: input.report.signalOverrides?.lifecycle,
    runPolicy: input.report.signalOverrides?.runPolicy,
    capabilityArea: input.report.signalOverrides?.capabilityArea,
    sourceFile: input.report.signalOverrides?.sourceFile,
    profiles: input.report.signalOverrides?.profiles || [],
    scenarioTags: input.report.signalOverrides?.scenarioTags || [],
    toolSequence: inspected.toolSequence,
    toolCounts: inspected.toolCounts,
    toolResultCodeCounts: inspected.toolResultCodeCounts,
    stepActionSequence: inspected.stepActionSequence,
    stepActionCounts: inspected.stepActionCounts,
    skillActivationSequence: inspected.skillActivationSequence,
    failedAssertionIds: input.assertions.failedAssertionIds,
    artifactOperationCounts: inspected.artifactOperationCounts,
    deliveryTaskIds: inspected.deliveryTaskIds,
    deliverySectionCounts: inspected.deliverySectionCounts,
    synthesisTriggered: inspected.synthesisTriggered,
    finalDeliverySource: inspected.finalDeliverySource,
    resultDataKeys: toJsonObjectKeys(input.report.execution.resultData),
    firstFailureStage: inspected.firstFailureStage,
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
  const resultDataKeysText = signals.resultDataKeys.length > 0 ? signals.resultDataKeys.join(', ') : 'none'
  const requiredFixturesText =
    signals.requiredFixtures.length > 0 ? signals.requiredFixtures.join(', ') : 'none'
  const profilesText = signals.profiles.length > 0 ? signals.profiles.join(', ') : 'none'
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
    `- qualityGrade: ${metrics.qualityGrade || 'unknown'}`,
    `- description: ${signals.description || 'none'}`,
    `- toolSequence: ${toolSequenceText}`,
    `- skillActivationSequence: ${skillActivationText}`,
    `- scenarioTags: ${scenarioTagText}`,
    `- taskGoal: ${signals.taskGoal || 'none'}`,
    `- requiredFixtures: ${requiredFixturesText}`,
    `- retentionTier: ${signals.retentionTier || 'none'}`,
    `- lifecycle: ${signals.lifecycle || 'none'}`,
    `- runPolicy: ${signals.runPolicy || 'none'}`,
    `- capabilityArea: ${signals.capabilityArea || 'none'}`,
    `- sourceFile: ${signals.sourceFile || 'none'}`,
    `- profiles: ${profilesText}`,
    `- maxSteps: ${signals.maxSteps ?? 'none'}`,
    `- modelName: ${signals.modelName || 'none'}`,
    `- resultDataKeys: ${resultDataKeysText}`,
    `- taskDeliveryCount: ${metrics.taskDeliveryCount}`,
    `- finalDeliverySource: ${metrics.finalDeliverySource || 'none'}`,
    `- synthesisTriggered: ${signals.synthesisTriggered}`,
    `- approvalDeniedCount: ${metrics.approvalDeniedCount}`,
    `- toolErrorCount: ${metrics.toolErrorCount ?? 0}`,
    `- repeatedToolCallCount: ${metrics.repeatedToolCallCount ?? 0}`,
    `- stepBudgetUsage: ${metrics.stepBudgetUsage ?? 'none'}`,
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
