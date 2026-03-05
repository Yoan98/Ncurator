import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../src/shared/types'
import type { CaseReportInput, CaseRuntimeMetrics } from './types'

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

const buildMetrics = (input: {
  startedAt: number
  finishedAt: number
  events: AiRunEvent[]
}): CaseRuntimeMetrics => {
  const events = input.events
  return {
    durationMs: Math.max(0, input.finishedAt - input.startedAt),
    eventCount: events.length,
    toolCallCount: events.filter((event) => event.type === 'tool_call_started').length,
    humanStepCount: events.filter((event) => event.type === 'human_step').length,
    terminalStepCount: events.filter((event) => event.type.startsWith('terminal_step_')).length,
    fileArtifactCount: events.filter((event) => event.type === 'file_artifact').length
  }
}

const buildSummaryMarkdown = (input: {
  report: CaseReportInput
  metrics: CaseRuntimeMetrics
}): string => {
  const { report, metrics } = input
  const assertionPassed = report.assertions.filter((item) => item.pass).length
  const assertionTotal = report.assertions.length
  return [
    `# ${report.caseId}`,
    '',
    `- suite: ${report.suite}`,
    `- status: ${report.status}`,
    `- runId: ${report.runId}`,
    `- taskId: ${report.taskId}`,
    `- durationMs: ${metrics.durationMs}`,
    `- assertions: ${assertionPassed}/${assertionTotal}`,
    '',
    '## Analysis',
    `- failure_category: ${report.analysis.failure_category}`,
    `- suspected_root_cause: ${report.analysis.suspected_root_cause}`,
    '- optimization_hints:',
    ...report.analysis.optimization_hints.map((hint) => `  - ${hint}`),
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

  const metrics = buildMetrics({
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    events: input.events
  })

  const assertionsPath = path.join(reportRoot, 'assertions.json')
  const eventsPath = path.join(reportRoot, 'events.jsonl')
  const metricsPath = path.join(reportRoot, 'metrics.json')
  const summaryPath = path.join(reportRoot, 'summary.md')

  const assertionsPayload = JSON.stringify(
    {
      runId: input.runId,
      taskId: input.taskId,
      status: input.status,
      assertions: input.assertions
    },
    null,
    2
  )
  const metricsPayload = JSON.stringify(
    {
      runId: input.runId,
      taskId: input.taskId,
      ...metrics,
      ...input.analysis
    },
    null,
    2
  )

  await writeFile(eventsPath, toJsonLines(input.events), 'utf8')
  await writeFile(assertionsPath, assertionsPayload, 'utf8')
  await writeFile(metricsPath, metricsPayload, 'utf8')
  await writeFile(
    summaryPath,
    buildSummaryMarkdown({
      report: input,
      metrics
    }),
    'utf8'
  )

  return reportRoot
}
