import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createTerminalToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunCommandResult = {
  error?: string
  output: string
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-result-unusable-docx-output', async () => {
    await runBackendCase({
      caseId: 'terminal-result-unusable-docx-output',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description:
        '验证 terminal_run 读到明显二进制/结构化文档输出时会省略原始输出并返回 terminal result unusable。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'report.docx', [
          { type: 'heading', text: 'Weekly Report' },
          { type: 'paragraph', text: 'Normal docx content.' }
        ])
        await fs.writeFile(`${runtime.workspaceRoot}/notes.txt`, 'alpha\nbeta\n')
        const harness = createTerminalToolHarness(runtime)

        const docxRead = await harness.invoke<TerminalRunCommandResult & { terminalId: string }>(
          'terminal_run',
          {
            command: isWindows ? 'Get-Content -LiteralPath report.docx' : 'cat report.docx'
          }
        )
        const result = {
          docxRead,
          textRead: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            terminalId: docxRead.terminalId,
            command: isWindows ? 'Get-Content -LiteralPath notes.txt' : 'cat notes.txt'
          })
        }
        await harness.release()
        return result
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.docxRead.error === 'terminal result unusable' &&
            !result.docxRead.output.includes('PK'),
          {
            name: 'terminal-docx-binary-output-is-omitted',
            message:
              'terminal_run 读取 docx 后应省略不可消费输出，并返回 terminal result unusable。',
            data: result.docxRead
          }
        )

        runtime.assertThat(
          !result.textRead.error &&
            result.textRead.output.includes('alpha') &&
            result.textRead.output.includes('beta'),
          {
            name: 'terminal-normal-text-output-is-preserved',
            message: '普通文本输出不应被不可消费输出检测误伤。',
            data: result.textRead
          }
        )
      }
    })
  })
})
