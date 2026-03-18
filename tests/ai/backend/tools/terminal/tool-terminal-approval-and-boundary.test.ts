import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, getEventsByType } from '../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-approval-and-boundary',
  caseType: 'scenario',
  groups: ['terminal'],
  description: '覆盖需要审批的写操作，以及越界路径在执行前被阻断。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime)
    const approved = await harness.invoke<{
      ok: boolean
      artifacts: Array<{ path: string }>
    }>('terminal_run_command', {
      command: 'touch approved.txt'
    })
    const boundary = await harness.invoke<{
      ok: boolean
      code: string
      error?: string
    }>('terminal_run_command', {
      command: 'cat ../outside.txt'
    })

    return {
      approved,
      boundary,
      approvalEvents: getEventsByType(runtime, 'approval_required'),
      terminalSteps: getEventsByType(runtime, 'terminal_step_started')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.approved.ok && result.approved.artifacts.length === 1, {
      name: 'terminal-approval-approved',
      message: '需要审批的 touch 命令应在自动批准后成功执行'
    })
    runtime.assertThat(
      !result.boundary.ok &&
        result.boundary.code === 'workspace_required' &&
        String(result.boundary.error || '').includes('workspace boundary'),
      {
        name: 'terminal-boundary-blocked',
        message: '越界路径应在真正执行前被工作区边界检查阻断'
      }
    )
    runtime.assertThat(result.approvalEvents.length === 1 && result.terminalSteps.length === 1, {
      name: 'terminal-boundary-no-step',
      message: '越界命令不应产生 terminal_step_started 事件'
    })
  }
})
