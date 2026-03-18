import fs from 'node:fs/promises'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-approval-denied-follow-up',
  caseType: 'scenario',
  groups: ['terminal'],
  description: '审批拒绝后，系统停止写操作，但仍能继续执行后续安全读取命令。',
  fixtures: ['tests/fixtures/ai/workspace/human-input.txt'],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime, {
      approvalPolicy: 'deny-all'
    })
    const denied = await harness.invoke<{
      ok: boolean
      code: string
    }>('terminal_run_command', {
      command: 'touch ai/workspace/blocked.txt'
    })
    const followUp = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'cat ai/workspace/human-input.txt'
    })
    const blockedExists = await fs
      .stat(`${runtime.workspaceRoot}/ai/workspace/blocked.txt`)
      .then(() => true)
      .catch(() => false)

    return {
      denied,
      followUp,
      blockedExists
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(!result.denied.ok && result.denied.code === 'approval_denied', {
      name: 'terminal-approval-denied',
      message: '拒绝审批后，写命令应返回 approval_denied'
    })
    runtime.assertThat(!result.blockedExists, {
      name: 'terminal-approval-denied-no-file',
      message: '被拒绝的写命令不应留下产物文件'
    })
    runtime.assertThat(
      result.followUp.ok && result.followUp.outputPreview.includes('workspace read validation'),
      {
        name: 'terminal-approval-denied-follow-up-read',
        message: '审批拒绝后应仍可继续执行低风险读取命令'
      }
    )
  }
})
