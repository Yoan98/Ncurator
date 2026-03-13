import path from 'node:path'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { describe, expect, test } from 'vitest'
import { buildTerminalCapabilityTools } from '../../../../src/main/services/ai/tools/terminal_exec/terminalTools'
import type { AiRunEvent } from '../../../../src/shared/types'
import { recordAssertion } from '../../../harness/main/assertions'
import { runCapabilityCase } from '../../../harness/main/capabilityCase'
import { readLatestCaseReportArtifacts } from '../../../harness/main/reportInspector'

const BOUNDARY_CASE_ID = 'terminal-workspace-boundary-rejected'
const APPROVAL_DENIED_CASE_ID = 'terminal-risk-approval-denied'
const CWD_NORMALIZATION_CASE_ID = 'terminal-cwd-normalization'
const TERMINAL_BOUNDARY_BASE_METADATA = {
  requiredFixtures: [],
  retentionTier: 'canonical',
  lifecycle: 'active',
  runPolicy: 'gating',
  capabilityArea: 'terminal-exec'
} as const
const BOUNDARY_CASE_METADATA = {
  ...TERMINAL_BOUNDARY_BASE_METADATA,
  description: '验证 terminal_run_command 对 ../ 与越界绝对路径的 workspace 拒绝行为。',
  expectedOutcome: 'blocked',
  scenarioTags: ['terminal', 'boundary', 'negative-path']
} as const
const APPROVAL_DENIED_CASE_METADATA = {
  ...TERMINAL_BOUNDARY_BASE_METADATA,
  description: '验证 terminal 中风险命令在 deny-medium-high 策略下返回 approval_denied。',
  expectedOutcome: 'blocked',
  scenarioTags: ['terminal', 'approval', 'negative-path']
} as const
const CWD_NORMALIZATION_CASE_METADATA = {
  ...TERMINAL_BOUNDARY_BASE_METADATA,
  description: '验证 terminal 对 workspace 根目录别名 cwd 的归一化，以及对不存在 cwd 的 fail-fast。',
  expectedOutcome: 'success',
  scenarioTags: ['terminal', 'cwd', 'normalization', 'negative-path']
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

const getToolByName = (tools: StructuredToolInterface[], name: string): StructuredToolInterface => {
  const found = tools.find((item) => String(item.name) === name)
  if (!found) throw new Error(`tool not found: ${name}`)
  return found
}

const countEvents = (events: AiRunEvent[], type: AiRunEvent['type']): number => {
  return events.filter((event) => event.type === type).length
}

describe('capability/terminal', () => {
  test('terminal_run_command should reject workspace boundary escapes before execution', async () => {
    await runCapabilityCase({
      caseId: BOUNDARY_CASE_ID,
      description: BOUNDARY_CASE_METADATA.description,
      caseMetadata: BOUNDARY_CASE_METADATA,
      expectedOutcome: BOUNDARY_CASE_METADATA.expectedOutcome,
      scenarioTags: BOUNDARY_CASE_METADATA.scenarioTags,
      requiredFixtures: BOUNDARY_CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const code = asString(asRecord(result.escapeResult).code) || 'unknown'
        return {
          status: code === 'workspace_required' ? 'blocked' : code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: `escape=${code}, absolute=${asString(asRecord(result.absoluteResult).code)}`
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

        const escapeResult = asRecord(
          (await terminalTool.invoke({ command: 'cat ../outside.txt' })) as JsonValue
        )
        const absoluteResult = asRecord(
          (await terminalTool.invoke({ command: 'cat /tmp/outside.txt' })) as JsonValue
        )
        const events = runtime.eventCollector.snapshot()

        return {
          escapeResult,
          absoluteResult,
          events
        }
      },
      assert: async (result, runtime) => {
        const events = result.events as AiRunEvent[]

        recordAssertion(runtime.assertions, {
          id: 'terminal.boundary.escape.workspace-required',
          pass:
            asBoolean(asRecord(result.escapeResult).ok) === false &&
            asString(asRecord(result.escapeResult).code) === 'workspace_required',
          details: JSON.stringify(asRecord(result.escapeResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.boundary.absolute.workspace-required',
          pass:
            asBoolean(asRecord(result.absoluteResult).ok) === false &&
            asString(asRecord(result.absoluteResult).code) === 'workspace_required',
          details: JSON.stringify(asRecord(result.absoluteResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.boundary.no-terminal-steps',
          pass: countEvents(events, 'terminal_step_started') === 0,
          details: `terminal_step_started=${String(countEvents(events, 'terminal_step_started'))}`
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.boundary.no-approval',
          pass: countEvents(events, 'approval_required') === 0,
          details: `approval_required=${String(countEvents(events, 'approval_required'))}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', BOUNDARY_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.metrics.executionResultCode).toBe('workspace_required')
  })

  test('terminal_run_command should block medium-risk command when approval is denied', async () => {
    await runCapabilityCase({
      caseId: APPROVAL_DENIED_CASE_ID,
      description: APPROVAL_DENIED_CASE_METADATA.description,
      caseMetadata: APPROVAL_DENIED_CASE_METADATA,
      expectedOutcome: APPROVAL_DENIED_CASE_METADATA.expectedOutcome,
      scenarioTags: APPROVAL_DENIED_CASE_METADATA.scenarioTags,
      requiredFixtures: APPROVAL_DENIED_CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      approvalPolicy: 'deny-medium-high',
      buildExecutionOutcome: (result) => {
        const code = asString(asRecord(result.commandResult).code) || 'unknown'
        return {
          status: code === 'approval_denied' ? 'blocked' : code === 'ok' ? 'completed' : 'failed',
          resultCode: code,
          summary: asString(asRecord(result.commandResult).error)
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
        const commandResult = asRecord(
          (await terminalTool.invoke({ command: 'mkdir blocked-dir' })) as JsonValue
        )
        const events = runtime.eventCollector.snapshot()

        return {
          commandResult,
          events
        }
      },
      assert: async (result, runtime) => {
        const events = result.events as AiRunEvent[]

        recordAssertion(runtime.assertions, {
          id: 'terminal.approval-denied.result-code',
          pass:
            asBoolean(asRecord(result.commandResult).ok) === false &&
            asString(asRecord(result.commandResult).code) === 'approval_denied',
          details: JSON.stringify(asRecord(result.commandResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.approval-denied.event-required',
          pass: countEvents(events, 'approval_required') >= 1,
          details: `approval_required=${String(countEvents(events, 'approval_required'))}`
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.approval-denied.event-decision',
          pass:
            events.some(
              (event) => event.type === 'approval_decision' && event.approved === false
            ) && countEvents(events, 'terminal_step_started') === 0,
          details: `terminal_step_started=${String(countEvents(events, 'terminal_step_started'))}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', APPROVAL_DENIED_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('blocked')
    expect(report.metrics.executionResultCode).toBe('approval_denied')
    expect(report.metrics.approvalDeniedCount).toBe(1)
  })

  test('terminal_run_command should normalize workspace-root cwd alias and reject missing cwd before execution', async () => {
    await runCapabilityCase({
      caseId: CWD_NORMALIZATION_CASE_ID,
      description: CWD_NORMALIZATION_CASE_METADATA.description,
      caseMetadata: CWD_NORMALIZATION_CASE_METADATA,
      expectedOutcome: CWD_NORMALIZATION_CASE_METADATA.expectedOutcome,
      scenarioTags: CWD_NORMALIZATION_CASE_METADATA.scenarioTags,
      requiredFixtures: CWD_NORMALIZATION_CASE_METADATA.requiredFixtures,
      fixtureCopies: [],
      buildExecutionOutcome: (result) => {
        const aliasCode = asString(asRecord(result.aliasResult).code)
        const missingCode = asString(asRecord(result.missingResult).code)
        const completed = aliasCode === 'ok' && missingCode === 'invalid_input'
        return {
          status: completed ? 'completed' : 'failed',
          resultCode: completed ? 'ok' : missingCode || aliasCode || 'unknown',
          summary: `alias=${aliasCode}, missing=${missingCode}`
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
        const workspaceAlias = path.basename(runtime.workspaceRoot)
        const aliasResult = asRecord(
          (await terminalTool.invoke({ command: 'pwd', cwd: workspaceAlias })) as JsonValue
        )
        const missingResult = asRecord(
          (await terminalTool.invoke({ command: 'pwd', cwd: 'missing-dir' })) as JsonValue
        )
        const events = runtime.eventCollector.snapshot()

        return {
          aliasResult,
          missingResult,
          events,
          workspaceRoot: runtime.workspaceRoot
        }
      },
      assert: async (result, runtime) => {
        const events = result.events as AiRunEvent[]

        recordAssertion(runtime.assertions, {
          id: 'terminal.cwd.alias.normalized-to-root',
          pass:
            asBoolean(asRecord(result.aliasResult).ok) &&
            asString(asRecord(result.aliasResult).code) === 'ok' &&
            asString(asRecord(result.aliasResult).cwd) === String(result.workspaceRoot),
          details: JSON.stringify(asRecord(result.aliasResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.cwd.missing.invalid-input',
          pass:
            asBoolean(asRecord(result.missingResult).ok) === false &&
            asString(asRecord(result.missingResult).code) === 'invalid_input' &&
            asString(asRecord(result.missingResult).error).includes('cwd does not exist'),
          details: JSON.stringify(asRecord(result.missingResult))
        })
        recordAssertion(runtime.assertions, {
          id: 'terminal.cwd.missing.no-terminal-step',
          pass: countEvents(events, 'terminal_step_started') === 1,
          details: `terminal_step_started=${String(countEvents(events, 'terminal_step_started'))}`
        })
      }
    })

    const report = await readLatestCaseReportArtifacts('main-ai-capability', CWD_NORMALIZATION_CASE_ID)
    expect(report.assertions.caseStatus).toBe('passed')
    expect(report.metrics.executionStatus).toBe('completed')
    expect(report.metrics.executionResultCode).toBe('ok')
  })
})
