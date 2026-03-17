import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'

type TerminalRunResult = {
  ok: boolean
  code: string
  command?: string
  exitCode?: number | null
  error?: string
}

describe('terminal guardrails and failure', () => {
  it('blocks boundary escapes, respects denial decisions, rejects invalid cwd, and records command failures', async () => {
    await runBackendCase({
      caseId: 'terminal-guardrails-and-failure',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['terminal'],
      description: '验证 terminal capability 的 boundary、审批拒绝、cwd 校验与失败命令路径',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const defaultHarness = createTerminalToolHarness(runtime)
        const denyHarness = createTerminalToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })

        const boundaryResult = await defaultHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: 'cat /etc/hosts'
        })
        const deniedResult = await denyHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: 'touch denied.txt'
        })
        const invalidCwdResult = await defaultHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: 'pwd',
          cwd: 'missing-dir'
        })
        const failedResult = await defaultHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: 'false'
        })

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-guardrail-matrix',
          status: 'ok',
          message: 'terminal guardrail 与失败路径已经完成验证',
          data: {
            boundaryCode: boundaryResult.code,
            deniedCode: deniedResult.code,
            invalidCwdCode: invalidCwdResult.code,
            failedCode: failedResult.code
          }
        })

        return {
          boundaryResult,
          deniedResult,
          invalidCwdResult,
          failedResult,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.boundaryResult.code === 'workspace_required', {
          name: 'terminal-boundary-rejected',
          message: '工作区外绝对路径被 boundary check 拦截',
          data: {
            code: result.boundaryResult.code
          }
        })
        runtime.assertThat(result.deniedResult.code === 'approval_denied', {
          name: 'terminal-approval-denied',
          message: '审批拒绝后 terminal 命令不会执行',
          data: {
            code: result.deniedResult.code
          }
        })
        runtime.assertThat(result.invalidCwdResult.code === 'invalid_input', {
          name: 'terminal-invalid-cwd',
          message: '不存在的 cwd 会返回 invalid_input',
          data: {
            code: result.invalidCwdResult.code
          }
        })
        runtime.assertThat(
          result.failedResult.ok === false &&
            result.failedResult.code === 'failed' &&
            result.failedResult.exitCode === 1,
          {
            name: 'terminal-failed-command',
            message: '退出码非 0 的命令会返回 failed',
            data: {
              code: result.failedResult.code,
              exitCode: result.failedResult.exitCode
            }
          }
        )
        runtime.assertThat(!fs.existsSync(path.join(runtime.workspaceRoot, 'denied.txt')), {
          name: 'terminal-denied-no-write',
          message: '审批拒绝后没有生成 denied.txt'
        })

        const approvalDeniedEvents = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'approval_decision' && event.approved === false
        )
        const stepErrors = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'terminal_step_error'
        )
        const stepStarted = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'terminal_step_started'
        )

        runtime.assertThat(
          approvalDeniedEvents.length === 1 &&
            stepErrors.length === 1 &&
            stepStarted.length === 1,
          {
            name: 'terminal-guardrail-events-complete',
            message: '审批拒绝与失败命令的关键事件数量符合预期',
            data: {
              approvalDenied: approvalDeniedEvents.length,
              stepErrors: stepErrors.length,
              stepStarted: stepStarted.length
            }
          }
        )
      }
    })
  })
})
