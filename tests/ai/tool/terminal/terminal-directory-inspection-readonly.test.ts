import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  command: string
  cwd: string
  outputPreview: string
  stdoutPreview: string
  stderrPreview: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  artifacts: Array<{ path: string; operation: 'created' | 'updated' }>
  error?: string
}

describe('ai tool terminal backend', () => {
  it('terminal-directory-inspection-readonly', async () => {
    await runBackendCase({
      caseId: 'terminal-directory-inspection-readonly',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证 ls/find/pwd/wc 等只读命令的基础契约。',
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
          pwd: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'pwd'
          }),
          ls: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'ls materials/nested'
          }),
          find: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'find materials -type f'
          }),
          wc: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'wc -c materials/nested/daily-note.txt'
          }),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_required')
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')

        runtime.assertThat(
          result.pwd.ok &&
            result.ls.ok &&
            result.find.ok &&
            result.wc.ok &&
            approvalEvents.length === 0 &&
            stepErrors.length === 0,
          {
            name: 'readonly-directory-commands-run-without-approval',
            message: '目录与文件检查类只读命令应直接成功执行，且不触发审批。',
            data: {
              approvals: approvalEvents.length,
              stepErrors: stepErrors.length,
              codes: [result.pwd.code, result.ls.code, result.find.code, result.wc.code]
            }
          }
        )

        runtime.assertThat(
          result.pwd.outputPreview.includes(runtime.workspaceRoot) &&
            result.ls.outputPreview.includes('daily-note.txt') &&
            result.find.outputPreview.includes('materials/nested/daily-note.txt') &&
            result.wc.outputPreview.includes('daily-note.txt'),
          {
            name: 'readonly-directory-commands-return-stable-output',
            message: '只读命令输出应稳定可供后续推理消费，且不被当成文件产物。',
            data: {
              pwd: result.pwd.outputPreview,
              ls: result.ls.outputPreview,
              find: result.find.outputPreview,
              wc: result.wc.outputPreview,
              artifactCounts: [
                result.pwd.artifacts.length,
                result.ls.artifacts.length,
                result.find.artifacts.length,
                result.wc.artifacts.length
              ]
            }
          }
        )
      }
    })
  })
})
