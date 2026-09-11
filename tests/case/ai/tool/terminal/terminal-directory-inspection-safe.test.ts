import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  output: string
  reason?: string
  status?: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'not_executed'
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-directory-inspection-safe', async () => {
    await runBackendCase({
      caseId: 'terminal-directory-inspection-safe',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证 workspace 目录浏览与文本读取都可通过平台安全指令稳定完成。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'materials', 'nested'), {
          recursive: true
        })
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'materials', 'nested', 'daily-note.txt'),
          'alpha\nbeta\ngamma\n'
        )

        const harness = createTerminalToolHarness(runtime)

        const list = await harness.invoke<TerminalRunCommandResult & { terminalId: string }>(
          'terminal_run',
          {
            command: isWindows
              ? 'Get-ChildItem -LiteralPath materials -Recurse -Force'
              : 'ls -R materials'
          }
        )
        const result = {
          list,
          recursiveFind: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: list.terminalId,
            command: isWindows
              ? 'Get-ChildItem -LiteralPath materials -Recurse -File'
              : 'find materials -type f'
          }),
          safeEcho: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: list.terminalId,
            command: isWindows ? 'Write-Output "terminal safe check"' : 'echo terminal safe check'
          }),
          read: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: list.terminalId,
            command: isWindows
              ? 'Get-Content -LiteralPath materials/nested/daily-note.txt'
              : 'cat materials/nested/daily-note.txt'
          }),
          noMatch: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: list.terminalId,
            command: isWindows
              ? 'Get-Content -LiteralPath materials/nested/missing-value.txt'
              : 'grep -q missing-value materials/nested/daily-note.txt'
          }),
          events: runtime.eventCollector.snapshot()
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')
        const stepResults = filterEventsByType(result.events, 'terminal_step_result')
        const toolResults = filterEventsByType(result.events, 'tool_call_result')

        runtime.assertThat(
          !result.list.reason &&
            !result.recursiveFind.reason &&
            !result.safeEcho.reason &&
            !result.read.reason &&
            !result.noMatch.reason &&
            approvalEvents.length === 0 &&
            stepErrors.length === 0,
          {
            name: 'safe-shell-inspection-runs-without-approval',
            message: '目录浏览与文本读取类安全指令应直接成功执行，且不触发审批。',
            data: {
              approvals: approvalEvents.length,
              stepErrors: stepErrors.length,
              reasons: [
                result.list.reason,
                result.recursiveFind.reason,
                result.safeEcho.reason,
                result.read.reason
              ]
            }
          }
        )

        runtime.assertThat(
          result.noMatch.status === 'failed' &&
            stepResults.some(
              (event) => event.executionStatus === 'completed' && event.exitCode === 1
            ) &&
            toolResults.some(
              (event) =>
                event.toolName === 'terminal_run' &&
                event.result?.ok === true &&
                event.result.data &&
                typeof event.result.data === 'object' &&
                !Array.isArray(event.result.data) &&
                event.result.data.status === 'failed'
            ),
          {
            name: 'nonzero-exit-is-a-failed-command-result',
            message: '命令自然退出时即使退出码非零，也应记录为 failed 并把结果交给 brain 判断。',
            data: {
              noMatch: result.noMatch,
              stepResults,
              toolResults: toolResults.map((event) => event.result)
            }
          }
        )

        runtime.assertThat(
          result.list.output.includes('daily-note.txt') &&
            result.recursiveFind.output.includes('daily-note.txt') &&
            result.safeEcho.output.includes('terminal safe check') &&
            result.read.output.includes('alpha') &&
            result.read.output.includes('gamma'),
          {
            name: 'safe-shell-inspection-returns-stable-output',
            message: 'terminal_run 应为目录浏览与文本读取返回可消费的稳定输出。',
            data: {
              list: result.list,
              safeEcho: result.safeEcho,
              read: result.read
            }
          }
        )
      }
    })
  })
})
