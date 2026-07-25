import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
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
      description:
        'Dangerous terminal commands require approval while ordinary writes use the same risk rules.',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const guardedDir = path.join(runtime.workspaceRoot, 'guarded')
        const blockedDir = path.join(runtime.workspaceRoot, 'blocked-dir')
        await fs.mkdir(guardedDir, { recursive: true })
        await fs.writeFile(path.join(guardedDir, 'keep.txt'), 'keep\n')

        const harness = createTerminalToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })
        const result = {
          unsafeDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Remove-Item -Recurse -Force guarded' : 'rm -rf guarded'
          }),
          writeDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows
              ? 'New-Item -ItemType Directory -Path blocked-dir'
              : 'mkdir blocked-dir'
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
        const stepErrors = filterEventsByType(result.events, 'terminal_step_error')
        const toolResults = filterEventsByType(result.events, 'tool_call_result')
        const deniedResults = toolResults.filter(
          (event) =>
            event.toolName === 'terminal_run' &&
            event.result?.data &&
            typeof event.result.data === 'object' &&
            !Array.isArray(event.result.data) &&
            event.result.data.reason === 'approval_denied'
        )

        runtime.assertThat(
          result.unsafeDenied.reason === 'approval_denied' &&
            result.writeDenied.reason === 'approval_denied' &&
            result.guardedStillExists &&
            !result.blockedDirExists &&
            approvalEvents.length === 2 &&
            deniedResults.length === 2 &&
            stepErrors.length === 0,
          {
            name: 'dangerous-commands-stop-at-approval',
            message: 'Dangerous terminal commands must be reviewed before execution.',
            data: { result, approvals: approvalEvents }
          }
        )
      }
    })
  })
})
