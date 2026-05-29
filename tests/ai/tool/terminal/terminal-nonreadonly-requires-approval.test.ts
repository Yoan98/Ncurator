import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../harness/backend/run-backend-case'
import { filterEventsByType } from '../testHelpers'

type TerminalRunCommandResult = {
  reason?: 'approval_denied' | 'workspace_required' | 'invalid_input' | 'failed'
}

describe('ai tool terminal backend', () => {
  it('terminal-nonreadonly-requires-approval', async () => {
    await runBackendCase({
      caseId: 'terminal-nonreadonly-requires-approval',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证未命中只读白名单但并非高危的 terminal 命令仍必须审批。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const createdDir = path.join(runtime.workspaceRoot, 'blocked-dir')
        const harness = createTerminalToolHarness(runtime, {
          approvalPolicy: 'deny-all'
        })

        return {
          mkdirDenied: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: 'mkdir blocked-dir'
          }),
          blockedDirExists: await fs
            .access(createdDir)
            .then(() => true)
            .catch(() => false),
          events: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        const approvalEvents = filterEventsByType(result.events, 'approval_batch_required')

        runtime.assertThat(
          result.mkdirDenied.reason === 'approval_denied' &&
            result.blockedDirExists === false &&
            approvalEvents.some((event) =>
              event.items.some((item) => item.command === 'mkdir blocked-dir')
            ),
          {
            name: 'non-readonly-command-requires-approval-even-without-risk-tiering',
            message: '未命中只读白名单的 terminal 命令即使不是旧语义里的高危命令，也必须先审批。',
            data: {
              mkdirDenied: result.mkdirDenied,
              blockedDirExists: result.blockedDirExists,
              approvals: approvalEvents.map((event) => ({
                command: event.items[0]?.command,
                reason: event.items[0]?.reason
              }))
            }
          }
        )
      }
    })
  })
})
