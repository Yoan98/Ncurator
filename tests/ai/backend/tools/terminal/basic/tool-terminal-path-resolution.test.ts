import path from 'node:path'
import { createTerminalToolHarness } from '../../../../../harness/backend/aiToolHarness'
import { defineAiToolCase } from '../../helpers'

const HUMAN_INPUT_FIXTURE = path.resolve('tests/fixtures/ai/workspace/human-input.txt')

defineAiToolCase({
  caseId: 'tool-terminal-path-resolution',
  caseType: 'basic',
  groups: ['terminal', 'basic'],
  description: '混用相对 cwd、绝对 cwd 和根目录别名时仍能稳定读取工作区文件。',
  fixtures: ['tests/fixtures/ai/workspace/human-input.txt'],
  runMode: 'repeatable',
  execute: async (runtime) => {
    const harness = createTerminalToolHarness(runtime)
    const fixtureWorkspacePath = runtime.getFixtureWorkspacePath(HUMAN_INPUT_FIXTURE)
    const fixtureDir = path.dirname(fixtureWorkspacePath)
    const rootAlias = path.basename(runtime.workspaceRoot)

    const relativeCwd = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'cat human-input.txt',
      cwd: 'ai/workspace'
    })
    const absoluteCwd = await harness.invoke<{
      ok: boolean
      outputPreview: string
    }>('terminal_run_command', {
      command: 'cat human-input.txt',
      cwd: fixtureDir
    })
    const aliasCwd = await harness.invoke<{
      ok: boolean
      cwd: string
      outputPreview: string
    }>('terminal_run_command', {
      command: 'pwd',
      cwd: rootAlias
    })

    return {
      relativeCwd,
      absoluteCwd,
      aliasCwd
    }
  },
  assert: async (result, runtime) => {
    runtime.assertThat(
      result.relativeCwd.ok && result.relativeCwd.outputPreview.includes('workspace read validation'),
      {
        name: 'terminal-path-relative-cwd',
        message: '相对 cwd 应能定位到 fixture 文件'
      }
    )
    runtime.assertThat(
      result.absoluteCwd.ok && result.absoluteCwd.outputPreview.includes('Hello from human fixture.'),
      {
        name: 'terminal-path-absolute-cwd',
        message: '绝对 cwd 应能定位到同一份 fixture 文件'
      }
    )
    runtime.assertThat(
      result.aliasCwd.ok && result.aliasCwd.cwd === runtime.workspaceRoot && result.aliasCwd.outputPreview.includes(runtime.workspaceRoot),
      {
        name: 'terminal-path-root-alias',
        message: '工作区根目录别名应被正确解析回 workspace root'
      }
    )
  }
})
