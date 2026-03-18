import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-workspace-material-discovery',
  caseType: 'basic',
  groups: ['terminal'],
  description: '在多层目录里发现材料，并读取最新日报中的可复用内容。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/daily/2026-03-14-note.md',
    'tests/fixtures/ai/workspace/materials/daily/2026-03-16-note.md'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime)
    const list = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'find ai/workspace/materials/daily -type f | sort'
    })
    const latest = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'cat ai/workspace/materials/daily/2026-03-16-note.md'
    })

    return {
      list,
      latest
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.list.ok, {
      name: 'terminal-discovery-list-ok',
      message: 'find 命令应成功列出日报材料'
    })
    runtime.assertThat(
      result.list.outputPreview.includes('2026-03-14-note.md') &&
        result.list.outputPreview.includes('2026-03-16-note.md'),
      {
        name: 'terminal-discovery-list-files',
        message: '材料发现结果应包含两份日报'
      }
    )
    runtime.assertThat(
      result.latest.ok &&
        result.latest.outputPreview.includes('Integration review completed') &&
        result.latest.outputPreview.includes('approval flow'),
      {
        name: 'terminal-discovery-read-latest',
        message: '读取最新日报时应拿到可复用的事实内容'
      }
    )
  }
})
