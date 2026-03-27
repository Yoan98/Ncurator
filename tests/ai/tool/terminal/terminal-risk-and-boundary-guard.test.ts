import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  error?: string
}

describe('ai tool terminal backend', () => {
  it('terminal-risk-and-boundary-guard', async () => {
    await runBackendCase({
      caseId: 'terminal-risk-and-boundary-guard',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证高风险命令审批、路径逃逸和 workspace 边界保护。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const guardedDir = path.join(runtime.workspaceRoot, 'guarded')
        await fs.mkdir(guardedDir, { recursive: true })
        await fs.writeFile(path.join(guardedDir, 'keep.txt'), 'keep\n')

        const harness = createTerminalToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })

        return {
          highRiskDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'rm -rf guarded'
          }),
          relativeEscape: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'cat ../outside.txt'
          }),
          absoluteEscape: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'cat /tmp/outside.txt'
          }),
          guardedStillExists: await fs
            .access(path.join(guardedDir, 'keep.txt'))
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_required')
        const stepStarted = filterEventsByType(result.events, 'terminal_step_started')

        runtime.assertThat(
          result.highRiskDenied.ok === false &&
            result.highRiskDenied.code === 'approval_denied' &&
            approvalEvents.some((event) => event.command === 'rm -rf guarded') &&
            result.guardedStillExists,
          {
            name: 'high-risk-commands-stop-at-approval',
            message: '高风险 terminal 命令应先触发审批；审批拒绝后不得产生副作用。',
            data: {
              highRiskDenied: result.highRiskDenied,
              approvals: approvalEvents.map((event) => ({
                command: event.command,
                riskLevel: event.riskLevel
              })),
              guardedStillExists: result.guardedStillExists
            }
          }
        )

        runtime.assertThat(
          result.relativeEscape.ok === false &&
            result.relativeEscape.code === 'workspace_required' &&
            result.absoluteEscape.ok === false &&
            result.absoluteEscape.code === 'workspace_required' &&
            stepStarted.length === 0,
          {
            name: 'workspace-boundary-rejects-escaped-paths-before-execution',
            message: '相对路径逃逸和越界绝对路径都应在执行前被拒绝，不进入真正的 terminal step。',
            data: {
              relativeEscape: result.relativeEscape,
              absoluteEscape: result.absoluteEscape,
              terminalSteps: stepStarted.length
            }
          }
        )
      }
    })
  })
})
