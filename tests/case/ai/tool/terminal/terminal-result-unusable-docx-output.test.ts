import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunCommandResult = {
  error?: string
  output: string
}

const isWindows = process.platform === 'win32'

/** Cross-platform sample: ≥25% U+FFFD over ≥100 chars so ratio omit is stable on Windows and macOS. */
const UNUSABLE_TEXT = `${'�'.repeat(40)}${'safe-prefix-'.repeat(6)}`

describe('ai tool terminal backend', () => {
  it('terminal-result-unusable-docx-output', async () => {
    await runBackendCase({
      caseId: 'terminal-result-unusable-docx-output',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description:
        '验证 terminal_run 读到高比例替换符输出时会省略原始输出并返回比例事实提示；普通文本不被误伤。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.writeFile(`${runtime.workspaceRoot}/garbled.txt`, UNUSABLE_TEXT, 'utf8')
        await fs.writeFile(`${runtime.workspaceRoot}/notes.txt`, 'alpha\nbeta\n', 'utf8')
        const harness = createTerminalToolHarness(runtime)

        const garbledRead = await harness.invoke<
          TerminalRunCommandResult & { terminalId: string }
        >('terminal_run', {
          command: isWindows
            ? 'Get-Content -LiteralPath garbled.txt -Raw -Encoding utf8'
            : 'cat garbled.txt'
        })
        const result = {
          garbledRead,
          textRead: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: garbledRead.terminalId,
            command: isWindows
              ? 'Get-Content -LiteralPath notes.txt -Raw -Encoding utf8'
              : 'cat notes.txt'
          })
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          typeof result.garbledRead.error === 'string' &&
            result.garbledRead.error.includes('终端输出含过多不可读字符') &&
            result.garbledRead.output.includes('omitted') &&
            !result.garbledRead.output.includes('safe-prefix-'),
          {
            name: 'terminal-high-replacement-output-is-omitted',
            message:
              'terminal_run 读取高比例替换符文本后应省略原始输出，并返回不可读字符比例提示。',
            data: result.garbledRead
          }
        )

        runtime.assertThat(
          !result.textRead.error &&
            result.textRead.output.includes('alpha') &&
            result.textRead.output.includes('beta'),
          {
            name: 'terminal-normal-text-output-is-preserved',
            message: '普通文本输出不应被不可读字符比例检测误伤。',
            data: result.textRead
          }
        )
      }
    })
  })
})
