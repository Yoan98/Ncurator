import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeUiCaseReport } from '../../../harness/e2e/reporter'

type FailureSignalsReport = {
  failedAssertionIds: string[]
  routeSequence: string[]
  userActionSequence: string[]
  ipcInvokeSequence: string[]
  selectorFailures: string[]
  taskGoal?: string
}

type FailureMetricsReport = {
  caseErrorCode: string
  executionResultCode: string
}

type FailureArtifactsReport = {
  screenshots: string[]
  trace?: string
  dom: string[]
  console: string
}

const readJson = async <T>(target: string): Promise<T> => {
  const raw = await readFile(target, 'utf8')
  return JSON.parse(raw) as T
}

describe('chat.failure-report-contract', () => {
  it('writes enough structured evidence for a targeted AI fix-and-rerun workflow', async () => {
    const startedAt = Date.now()
    const reportRoot = await writeUiCaseReport({
      suite: 'e2e-chat',
      caseId: 'chat-failure-report-contract',
      startedAt,
      finishedAt: startedAt + 25,
      executionStatus: 'failed',
      executionResultCode: 'runtime_exception',
      assertions: [
        {
          id: 'chat-right-panel-title-missing',
          pass: false,
          details: 'Expected right panel title to contain 检索结果'
        }
      ],
      notes: ['Simulated failure report for AI-directed regression validation.'],
      aiRunEvents: [],
      routeSequence: ['#/chat'],
      userActionSequence: ['fill:[e2e:chat-plan-artifact] 生成测试产物', 'click:chat-send-button'],
      ipcInvokeSequence: ['aiRunStart'],
      selectorFailures: ['chat-right-panel-title'],
      consoleEntries: [{ level: 'error', text: 'Simulated renderer failure' }],
      screenshotRefs: ['screenshots/failure.png'],
      traceRef: 'trace/trace.zip',
      domRefs: ['dom/final.html'],
      expectedOutcome: 'success',
      scenarioTags: ['e2e', 'chat', 'failure-contract'],
      taskGoal: 'Use this failed chat report to locate a missing right-panel render and rerun the same case after fixing it.'
    })

    const [signals, metrics, artifacts, summary] = await Promise.all([
      readJson<FailureSignalsReport>(path.join(reportRoot, 'signals.json')),
      readJson<FailureMetricsReport>(path.join(reportRoot, 'metrics.json')),
      readJson<FailureArtifactsReport>(path.join(reportRoot, 'artifacts.json')),
      readFile(path.join(reportRoot, 'summary.md'), 'utf8')
    ])

    expect(metrics.caseErrorCode).toBe('runtime_exception')
    expect(metrics.executionResultCode).toBe('runtime_exception')
    expect(signals.failedAssertionIds).toContain('chat-right-panel-title-missing')
    expect(signals.routeSequence).toEqual(['#/chat'])
    expect(signals.userActionSequence).toContain('click:chat-send-button')
    expect(signals.ipcInvokeSequence).toContain('aiRunStart')
    expect(signals.selectorFailures).toContain('chat-right-panel-title')
    expect(signals.taskGoal).toContain('right-panel')
    expect(artifacts.screenshots).toContain('screenshots/failure.png')
    expect(artifacts.trace).toBe('trace/trace.zip')
    expect(artifacts.dom).toContain('dom/final.html')
    expect(artifacts.console).toBe('console.jsonl')
    expect(summary).toContain('taskGoal:')
  })
})
