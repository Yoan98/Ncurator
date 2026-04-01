import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  ok: boolean
  code: 'ok' | 'failed' | 'invalid_input' | 'approval_denied' | 'workspace_required'
  outputPreview: string
  error?: string
}

describe('ai tool terminal backend', () => {
  it('terminal-text-search-readonly', async () => {
    await runBackendCase({
      caseId: 'terminal-text-search-readonly',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证 rg/grep 搜索命令的只读契约与 workspace 边界约束。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'notes'), { recursive: true })
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'notes', 'release.md'),
          'Approval denied should keep existing files unchanged.\nTerminal artifacts must be recorded.\n'
        )
        await fs.writeFile(
          path.join(runtime.workspaceRoot, 'notes', 'director.md'),
          'Director path should not leave workspace scope.\n'
        )

        const harness = createTerminalToolHarness(runtime)

        return {
          rg: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'rg "Approval denied" notes'
          }),
          grep: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'grep -R "artifacts" notes'
          }),
          boundaryRejected: await harness.invoke<TerminalRunCommandResult>('terminal_run_command', {
            command: 'rg "Director" ../'
          }),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_required')

        runtime.assertThat(
          result.rg.ok &&
            result.grep.ok &&
            result.rg.code === 'ok' &&
            result.grep.code === 'ok' &&
            approvalEvents.length === 0,
          {
            name: 'search-commands-stay-readonly',
            message: 'rg/grep 搜索命令应保持只读执行，不触发审批。',
            data: {
              approvals: approvalEvents.length,
              rg: result.rg,
              grep: result.grep
            }
          }
        )

        runtime.assertThat(
          result.rg.outputPreview.includes('release.md') &&
            result.grep.outputPreview.includes('Terminal artifacts must be recorded.') &&
            result.boundaryRejected.ok === false &&
            result.boundaryRejected.code === 'workspace_required',
          {
            name: 'search-commands-honor-boundary-checks',
            message: '文本搜索应正确返回命中结果，并在越界路径参数下于执行前拒绝。',
            data: {
              rg: result.rg.outputPreview,
              grep: result.grep.outputPreview,
              boundaryRejected: result.boundaryRejected
            }
          }
        )
      }
    })
  })
})
