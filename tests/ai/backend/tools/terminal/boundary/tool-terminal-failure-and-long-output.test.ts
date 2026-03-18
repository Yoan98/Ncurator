import { createTerminalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, getEventsByType } from '../../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-failure-and-long-output',
  caseType: 'boundary',
  groups: ['terminal', 'boundary'],
  description: '覆盖命令失败、长输出截断与错误事件收敛。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime, {}, {
      maxOutputChars: 300,
      safePreviewChars: 80
    })
    const failed = await harness.invoke<{
      ok: boolean
      code: string
      error?: string
      stderrPreview: string
      exitCode: number | null
    }>('terminal_run_command', {
      command: "sh -c 'echo boom >&2; exit 7'"
    })
    const longOutput = await harness.invoke<{
      ok: boolean
      code: string
      error?: string
      outputPreview: string
      truncated: boolean
    }>('terminal_run_command', {
      command: `node -e "process.stdout.write('A'.repeat(1200))"`
    })

    return {
      failed,
      longOutput,
      errorEvents: getEventsByType(runtime, 'terminal_step_error')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      !result.failed.ok &&
        result.failed.code === 'failed' &&
        result.failed.exitCode === 7 &&
        result.failed.stderrPreview.includes('boom'),
      {
        name: 'terminal-failure-path',
        message: '显式失败命令应返回 exitCode 与 stderr 摘要'
      }
    )
    runtime.assertThat(
      !result.longOutput.ok &&
        result.longOutput.code === 'failed' &&
        result.longOutput.truncated &&
        result.longOutput.outputPreview.length <= 80,
      {
        name: 'terminal-long-output-truncated',
        message: '超长输出应被截断并以失败态收敛'
      }
    )
    runtime.assertThat(result.errorEvents.length === 2, {
      name: 'terminal-error-events',
      message: '两条异常 terminal 命令都应写入 terminal_step_error 事件'
    })
  }
})
