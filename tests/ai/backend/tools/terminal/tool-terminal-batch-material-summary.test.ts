import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../helpers'

defineAiToolCase({
  caseId: 'tool-terminal-batch-material-summary',
  caseType: 'scenario',
  groups: ['terminal'],
  description: '一次读取多份材料并归并提炼出关键事实。',
  fixtures: [
    'tests/fixtures/ai/workspace/materials/batch/day-1.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-2.txt',
    'tests/fixtures/ai/workspace/materials/batch/day-3.txt'
  ],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime)
    const list = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'find ai/workspace/materials/batch -type f | sort'
    })
    const merged = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command:
        'cat ai/workspace/materials/batch/day-1.txt ai/workspace/materials/batch/day-2.txt ai/workspace/materials/batch/day-3.txt'
    })

    return {
      list,
      merged
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(result.list.ok && result.list.outputPreview.includes('day-3.txt'), {
      name: 'terminal-batch-list',
      message: '批量材料发现应列出全部 batch 文件'
    })
    runtime.assertThat(
      result.merged.ok &&
        result.merged.outputPreview.includes('workspace scan baseline') &&
        result.merged.outputPreview.includes('KB retrieval baseline') &&
        result.merged.outputPreview.includes('docx review handoff baseline'),
      {
        name: 'terminal-batch-merge',
        message: '批量读取后应能同时看到三份材料中的关键事实'
      }
    )
  }
})
