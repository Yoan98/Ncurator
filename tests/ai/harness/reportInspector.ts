import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AiRunEvent } from '../../../src/shared/types'

type CaseAssertionsReport = {
  runId: string
  taskId: string
  status: 'passed' | 'failed'
  assertions: Array<{
    id: string
    pass: boolean
    details?: string
  }>
}

type CaseMetricsReport = {
  runId: string
  taskId: string
  durationMs: number
  eventCount: number
  toolCallCount: number
  humanStepCount: number
  terminalStepCount: number
  fileArtifactCount: number
  failure_category: string
  suspected_root_cause: string
  optimization_hints: string[]
}

export type CaseReportArtifacts = {
  reportDir: string
  summary: string
  assertions: CaseAssertionsReport
  metrics: CaseMetricsReport
  events: AiRunEvent[]
}

const readJson = async <T>(filePath: string): Promise<T> => {
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as T
}

const readEvents = async (filePath: string): Promise<AiRunEvent[]> => {
  const raw = await readFile(filePath, 'utf8')
  if (!raw.trim()) return []
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as AiRunEvent)
}

const latestReportDir = async (suite: string, caseId: string): Promise<string> => {
  const root = path.resolve(process.cwd(), 'artifacts', 'ai-test-results', suite, caseId)
  const entries = await readdir(root, { withFileTypes: true })
  const latest = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => b.localeCompare(a))[0]

  if (!latest) {
    throw new Error(`report dir not found for ${suite}/${caseId}`)
  }
  return path.join(root, latest)
}

export const readLatestCaseReportArtifacts = async (
  suite: string,
  caseId: string
): Promise<CaseReportArtifacts> => {
  const reportDir = await latestReportDir(suite, caseId)
  const [summary, assertions, metrics, events] = await Promise.all([
    readFile(path.join(reportDir, 'summary.md'), 'utf8'),
    readJson<CaseAssertionsReport>(path.join(reportDir, 'assertions.json')),
    readJson<CaseMetricsReport>(path.join(reportDir, 'metrics.json')),
    readEvents(path.join(reportDir, 'events.jsonl'))
  ])

  return {
    reportDir,
    summary,
    assertions,
    metrics,
    events
  }
}
