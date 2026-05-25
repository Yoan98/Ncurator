import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required' | 'result_too_large'
  combinedOutput: string
  stdout: string
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-directory-inspection-readonly', async () => {
    await runBackendCase({
      caseId: 'terminal-directory-inspection-readonly',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证 workspace 目录浏览与文本读取都可通过单条只读命令稳定完成。',
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

        return {
          list: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Get-ChildItem -LiteralPath materials -Recurse -Force'
              : 'ls -R materials'
          }),
          recursiveFind: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Get-ChildItem -LiteralPath materials -Recurse -File'
              : 'find materials -type f'
          }),
          echoReadOnly: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Write-Output "terminal readonly check"' : 'echo terminal readonly check'
          }),
          read: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'Get-Content -LiteralPath materials/nested/daily-note.txt'
              : 'cat materials/nested/daily-note.txt'
          }),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')

        runtime.assertThat(
          result.list.ok &&
            result.recursiveFind.ok &&
            result.echoReadOnly.ok &&
            result.read.ok &&
            approvalEvents.length === 0 &&
            stepErrors.length === 0,
          {
            name: 'readonly-shell-inspection-runs-without-approval',
            message: '目录浏览与文本读取类只读命令应直接成功执行，且不触发审批。',
            data: {
              approvals: approvalEvents.length,
              stepErrors: stepErrors.length,
              codes: [
                result.list.code,
                result.recursiveFind.code,
                result.echoReadOnly.code,
                result.read.code
              ]
            }
          }
        )

        runtime.assertThat(
          result.list.combinedOutput.includes('daily-note.txt') &&
            result.recursiveFind.combinedOutput.includes('daily-note.txt') &&
            result.echoReadOnly.stdout.includes('terminal readonly check') &&
            result.read.stdout.includes('alpha') &&
            result.read.stdout.includes('gamma'),
          {
            name: 'readonly-shell-inspection-returns-stable-output',
            message: 'terminal_run 应为目录浏览与文本读取返回可消费的稳定输出。',
            data: {
              list: result.list,
              echoReadOnly: result.echoReadOnly,
              read: result.read
            }
          }
        )
      }
    })
  })
})
