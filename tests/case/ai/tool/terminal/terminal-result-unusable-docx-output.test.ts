import fs from 'node:fs/promises'
import { describe, it } from 'vitest'
import {
  createTerminalToolHarness,
  writeTestDocxFile
} from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunCommandResult = {
  reason?: 'result_unusable'
  error?: string
  stdout: string
  stderr: string
  decisionHint?: {
    code: 'hand_tool_result_unusable'
    detail: {
      toolName: string
      reason: 'non_text_output'
      totalChars: number
      nulCount: number
      replacementCharCount: number
      replacementCharRatio: number
      controlCharCount: number
      controlCharRatio: number
      matchedSignatures: string[]
    }
  }
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
      description: '验证 terminal_run 读到明显二进制/结构化文档输出时会省略原始输出并返回 decision hint。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await writeTestDocxFile(runtime.workspaceRoot, 'report.docx', [
          { type: 'heading', text: 'Weekly Report' },
          { type: 'paragraph', text: 'Normal docx content.' }
        ])
        await fs.writeFile(`${runtime.workspaceRoot}/notes.txt`, 'alpha\nbeta\n')
        const harness = createTerminalToolHarness(runtime)

        return {
          docxRead: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Get-Content -LiteralPath report.docx' : 'cat report.docx'
          }),
          textRead: await harness.invoke<TerminalRunCommandResult>('terminal_run', {
            command: isWindows ? 'Get-Content -LiteralPath notes.txt' : 'cat notes.txt'
          })
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.docxRead.reason === 'result_unusable' &&
            result.docxRead.error === 'terminal result unusable' &&
            result.docxRead.decisionHint?.code === 'hand_tool_result_unusable' &&
            result.docxRead.decisionHint.detail.matchedSignatures.length > 0 &&
            !result.docxRead.stdout.includes('PK') &&
            !result.docxRead.stderr.includes('PK'),
          {
            name: 'terminal-docx-binary-output-is-omitted',
            message: 'terminal_run 读取 docx 后应省略不可消费输出，并给出 hand_tool_result_unusable。',
            data: result.docxRead
          }
        )

        runtime.assertThat(
          !result.textRead.reason &&
            result.textRead.stdout.includes('alpha') &&
            result.textRead.stdout.includes('beta'),
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
