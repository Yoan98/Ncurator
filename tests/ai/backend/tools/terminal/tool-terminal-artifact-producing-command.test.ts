import fs from 'node:fs/promises'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase, getEventsByType } from '../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-artifact-producing-command',
  caseType: 'scenario',
  groups: ['terminal'],
  description: '执行会生成中间文件的命令，并验证产物识别与回读链路。',
  fixtures: [],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime)
    const command = await harness.invoke<{
      ok: boolean
      artifacts: Array<{ path: string; operation: string }>
    }>('terminal_run_command', {
      command: "printf 'generated summary for workbench stage 1\\n' > generated-summary.txt",
      expectedArtifacts: [
        {
          path: 'generated-summary.txt',
          summary: 'generated summary artifact'
        }
      ]
    })
    const readBack = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'cat generated-summary.txt'
    })
    const content = await fs.readFile(`${runtime.workspaceRoot}/generated-summary.txt`, 'utf8')

    return {
      command,
      readBack,
      content,
      approvalEvents: getEventsByType(runtime, 'approval_required'),
      artifactEvents: getEventsByType(runtime, 'file_artifact')
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.command.ok && result.command.artifacts.length === 1, {
      name: 'terminal-artifact-command-ok',
      message: '产物命令应返回已识别的文件产物'
    })
    runtime.assertThat(
      result.readBack.ok &&
        result.readBack.outputPreview.includes('generated summary for workbench stage 1') &&
        result.content.includes('generated summary for workbench stage 1'),
      {
        name: 'terminal-artifact-readback',
        message: '生成后的产物应能被再次读取'
      }
    )
    runtime.assertThat(result.approvalEvents.length === 1 && result.artifactEvents.length === 1, {
      name: 'terminal-artifact-events',
      message: '重定向写文件应触发一次审批和一次文件产物事件'
    })
  }
})
