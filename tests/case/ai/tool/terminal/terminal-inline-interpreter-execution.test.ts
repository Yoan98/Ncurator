import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunResult = {
  output: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
}

const listFiles = async (rootPath: string): Promise<string[]> => {
  const entries = await fs.readdir(rootPath, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(rootPath, entry.name)
      return entry.isDirectory() ? await listFiles(entryPath) : [entryPath]
    })
  )
  return nested.flat()
}

describe('ai tool terminal backend', () => {
  it('terminal-inline-interpreter-execution', async () => {
    await runBackendCase({
      caseId: 'terminal-inline-interpreter-execution',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证内联 Node.js 代码在审批通过后能够真实执行，且不会生成脚本文件。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTerminalToolHarness(runtime)
        try {
          const result = await harness.invoke<TerminalRunResult>('terminal_run', {
            command: 'node -e "console.log(\'NCURATOR_INLINE_OK\')"'
          })
          const scriptFiles = await listFiles(
            path.join(runtime.workspaceRoot, '.ncurator', 'runtime', 'scripts')
          )
          return {
            result,
            scriptFiles,
            events: runtime.eventCollector.snapshot()
          }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        // tool-real harness invokes terminal_run directly; approval is owned by handNode in full AI runs.
        runtime.assertThat(
          result.result.status === 'succeeded' &&
            result.result.output.includes('NCURATOR_INLINE_OK') &&
            result.scriptFiles.length === 0,
          {
            name: 'inline-node-code-executes-without-script-file',
            message: '内联 Node.js 代码应真实执行，且 runtime scripts 下不应出现脚本文件。',
            data: {
              result: result.result,
              scriptFiles: result.scriptFiles
            }
          }
        )
      }
    })
  })
})
