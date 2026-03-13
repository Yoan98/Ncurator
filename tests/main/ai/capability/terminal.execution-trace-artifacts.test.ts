import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildTerminalCapabilityTools } from '../../../../src/main/services/ai/tools/terminal_exec/terminalTools'
import type { AiRunEvent } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const CASE_ID = 'terminal-execution-trace-artifacts'
const CASE_METADATA = {
  description: '验证 terminal 执行成功/失败链路、terminal_step 事件与文件产物事件。',
  expectedOutcome: 'success',
  scenarioTags: ['terminal', 'trace', 'artifact', 'mixed-path'],
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'terminal-exec'
} as const

type JsonScalar = string | number | boolean | null

type JsonValue = JsonScalar | JsonRecord | JsonValue[]

type JsonRecord = {
  [key: string]: JsonValue
}

const asRecord = (value: JsonValue | undefined): JsonRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as JsonRecord
}

const asString = (value: JsonValue | undefined): string => {
  return String(value || '')
}

const asBoolean = (value: JsonValue | undefined): boolean => {
  return value === true
}

const asRecordArray = (value: JsonValue | undefined): JsonRecord[] => {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as JsonRecord[]
}

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const countEvents = (events: AiRunEvent[], type: AiRunEvent['type']): number => {
  return events.filter((event) => event.type === type).length
}

describe('capability/terminal', () => {
  test('terminal_run_command should expose success/failure traces and file artifact evidence', async () => {
    await runCapabilityCase({
      caseId: CASE_ID,
      description: CASE_METADATA.description,
      caseMetadata: CASE_METADATA,
      expectedOutcome: CASE_METADATA.expectedOutcome,
      scenarioTags: CASE_METADATA.scenarioTags,
      requiredFixtures: CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const okCode = asString(asRecord(result.okResult).code)
        const failCode = asString(asRecord(result.failResult).code)
        const artifactCode = asString(asRecord(result.artifactResult).code)
        const completed = okCode === 'ok' && failCode === 'failed' && artifactCode === 'ok'
        return {
          status: completed ? 'completed' : 'failed',
          resultCode: completed ? 'ok' : failCode || artifactCode || okCode || 'unknown',
          summary: `ok=${okCode}, fail=${failCode}, artifact=${artifactCode}`
        }
      },
      execute: async (runtime) => {
        const built = buildTerminalCapabilityTools({
          ctx: runtime.ctx,
          runId: runtime.runId,
          taskId: runtime.taskId,
          workspaceRootPath: runtime.workspaceRoot,
          timeoutMs: 8000,
          maxOutputChars: 8000,
          safePreviewChars: 600,
          emitActivity: (activity) => {
            runtime.ctx.sendEvent({
              type: 'activity',
              runId: runtime.runId,
              taskId: runtime.taskId,
              activityId: `activity-${Date.now().toString(36)}`,
              actionType: activity.actionType,
              status: activity.status,
              summary: activity.summary,
              createdAt: Date.now()
            })
          }
        })

        const terminalTool = getToolByName(built.tools, 'terminal_run_command')

        const okResult = asRecord((await terminalTool.invoke({ command: 'pwd' })) as JsonValue)
        const failResult = asRecord(
          (await terminalTool.invoke({ command: 'sh -c "exit 2"' })) as JsonValue
        )
        const artifactResult = asRecord(
          (await terminalTool.invoke({
            command: 'touch created.txt',
            expectedArtifacts: [
              {
                path: 'created.txt',
                operation: 'created',
                summary: 'created by terminal capability test'
              }
            ]
          })) as JsonValue
        )
        const events = runtime.eventCollector.snapshot()

        return {
          okResult,
          failResult,
          artifactResult,
          events,
          outputPath: path.join(runtime.workspaceRoot, 'created.txt')
        }
      },
      assert: async (result, runtime) => {
        const events = result.events as AiRunEvent[]
        const artifactEntries = asRecordArray(asRecord(result.artifactResult).artifacts)

        recordAssertion(runtime.assertions, {
          id: 'terminal.trace.ok-command-success',
          pass:
            asBoolean(asRecord(result.okResult).ok) &&
            asString(asRecord(result.okResult).code) === 'ok',
          details: JSON.stringify(asRecord(result.okResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.trace.failed-command-failed',
          pass:
            asBoolean(asRecord(result.failResult).ok) === false &&
            asString(asRecord(result.failResult).code) === 'failed' &&
            asString(asRecord(result.failResult).error).includes('code 2'),
          details: JSON.stringify(asRecord(result.failResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.trace.artifact-command-success',
          pass:
            asBoolean(asRecord(result.artifactResult).ok) &&
            asString(asRecord(result.artifactResult).code) === 'ok' &&
            artifactEntries.some((entry) => asString(entry.path).endsWith('created.txt')),
          details: JSON.stringify(asRecord(result.artifactResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.trace.step-events-complete',
          pass:
            countEvents(events, 'terminal_step_started') === 3 &&
            countEvents(events, 'terminal_step_result') >= 2 &&
            countEvents(events, 'terminal_step_error') >= 1,
          details: JSON.stringify({
            started: countEvents(events, 'terminal_step_started'),
            result: countEvents(events, 'terminal_step_result'),
            error: countEvents(events, 'terminal_step_error')
          })
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.trace.file-artifact-emitted',
          pass: events.some((event) => event.type === 'file_artifact' && event.path.endsWith('created.txt')),
          details: `file_artifact=${String(countEvents(events, 'file_artifact'))}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
    expect(report.metrics.terminalStepCount).toBeGreaterThanOrEqual(3)
    expect(report.metrics.fileArtifactCount).toBeGreaterThanOrEqual(1)
  })
})
