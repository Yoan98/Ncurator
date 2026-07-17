import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  reason?: 'approval_denied' | 'workspace_required' | 'invalid_input' | 'failed'
  error?: string
  executionStatus?: 'not_executed'
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-risk-and-boundary-guard', async () => {
    await runBackendCase({
      caseId: 'terminal-risk-and-boundary-guard',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证安全集外命令审批、路径逃逸和 workspace 边界保护。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const guardedDir = path.join(runtime.workspaceRoot, 'guarded')
        const blockedDir = path.join(runtime.workspaceRoot, 'blocked-dir')
        const outsidePath = path.join(path.dirname(runtime.workspaceRoot), 'outside.txt')
        await fs.mkdir(guardedDir, { recursive: true })
        await fs.writeFile(path.join(guardedDir, 'keep.txt'), 'keep\n')

        const harness = createTerminalToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })

        const result = {
          unsafeDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Remove-Item -Recurse -Force guarded' : 'rm -rf guarded'
          }),
          unlistedWriteDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'New-Item -ItemType Directory -Path blocked-dir'
              : 'mkdir blocked-dir'
          }),
          relativeEscape: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Get-Content ../outside.txt' : 'cat ../outside.txt'
          }),
          absoluteEscape: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? `Get-Content "${outsidePath}"` : `cat "${outsidePath}"`
          }),
          guardedStillExists: await fs
            .access(path.join(guardedDir, 'keep.txt'))
            .then(() => true)
            .catch(() => false),
          blockedDirExists: await fs
            .access(blockedDir)
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')
        const stepStarted = filterEventsByType(result.events, 'terminal_step_started')
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')
        const toolResults = filterEventsByType(result.events, 'tool_call_result')
        const approvalDeniedToolResults = toolResults.filter(
          (event) =>
            event.toolName === 'terminal_run' &&
            event.result?.data &&
            typeof event.result.data === 'object' &&
            !Array.isArray(event.result.data) &&
            event.result.data.reason === 'approval_denied'
        )

        runtime.assertThat(
          result.unsafeDenied.reason === 'approval_denied' &&
            result.unsafeDenied.executionStatus === 'not_executed' &&
            approvalEvents.some((event) =>
              event.items.some(
                (item) =>
                  item.command ===
                  (isWindows ? 'Remove-Item -Recurse -Force guarded' : 'rm -rf guarded')
              )
            ) &&
            result.guardedStillExists &&
            approvalDeniedToolResults.length === 2 &&
            approvalDeniedToolResults.every((event) => event.result?.ok === true) &&
            stepErrors.length === 0,
          {
            name: 'unsafe-commands-stop-at-approval',
            message: '安全集外 terminal 命令应先触发审批；审批拒绝后不得产生副作用。',
            data: {
              unsafeDenied: result.unsafeDenied,
              approvals: approvalEvents.map((event) => ({
                command: event.items[0]?.command,
                reason: event.items[0]?.reason
              })),
              approvalDeniedToolResults,
              stepErrors,
              guardedStillExists: result.guardedStillExists
            }
          }
        )

        runtime.assertThat(
          result.unlistedWriteDenied.reason === 'approval_denied' &&
            result.unlistedWriteDenied.executionStatus === 'not_executed' &&
            result.blockedDirExists === false &&
            approvalEvents.some((event) =>
              event.items.some(
                (item) =>
                  item.command ===
                  (isWindows
                    ? 'New-Item -ItemType Directory -Path blocked-dir'
                    : 'mkdir blocked-dir')
              )
            ),
          {
            name: 'unlisted-write-command-requires-approval',
            message: '未命中安全指令集的低风险写命令也必须先审批；审批拒绝后不得创建目录。',
            data: {
              unlistedWriteDenied: result.unlistedWriteDenied,
              blockedDirExists: result.blockedDirExists,
              approvals: approvalEvents.map((event) => ({
                command: event.items[0]?.command,
                reason: event.items[0]?.reason
              }))
            }
          }
        )

        runtime.assertThat(
          result.relativeEscape.reason === 'workspace_required' &&
            result.absoluteEscape.reason === 'workspace_required' &&
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
