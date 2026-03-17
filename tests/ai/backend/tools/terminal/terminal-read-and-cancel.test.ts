import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'

type TerminalRunResult = {
  ok: boolean
  code: string
  outputPreview: string
  stdoutPreview: string
  exitCode: number | null
}

describe('terminal read and cancel', () => {
  it('reads workspace material and records pre-execution cancellation cleanly', async () => {
    await runBackendCase({
      caseId: 'terminal-read-and-cancel',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['terminal'],
      description: '验证 terminal capability 能读取工作区材料并覆盖取消分支',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const notePath = path.join(runtime.workspaceRoot, 'notes.txt')
        await fs.writeFile(notePath, 'workspace material for stage 1')

        const readHarness = createTerminalToolHarness(runtime)
        const cancelledHarness = createTerminalToolHarness(runtime, {
          checkCancelledOverride: () => {
            throw new Error('terminal run cancelled by test')
          }
        })

        const readResult = await readHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: 'cat notes.txt'
        })

        let cancelledMessage = ''
        try {
          await cancelledHarness.invoke<TerminalRunResult>('terminal_run_command', {
            command: 'cat notes.txt'
          })
        } catch (error) {
          cancelledMessage = error instanceof Error ? error.message : String(error)
        }

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-read-and-cancel',
          status: 'ok',
          message: 'terminal 读取工作区文件与取消路径已经执行',
          data: {
            readCode: readResult.code,
            cancelledMessage
          }
        })

        return {
          readResult,
          cancelledMessage,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.readResult.ok &&
            result.readResult.code === 'ok' &&
            result.readResult.exitCode === 0 &&
            result.readResult.stdoutPreview.includes('workspace material for stage 1'),
          {
            name: 'terminal-read-workspace-material',
            message: 'terminal 能读取工作区内的文本材料',
            data: {
              stdoutPreview: result.readResult.stdoutPreview
            }
          }
        )
        runtime.assertThat(result.cancelledMessage === 'terminal run cancelled by test', {
          name: 'terminal-pre-execution-cancelled',
          message: 'terminal 在执行前取消时会向上抛出取消错误',
          data: {
            cancelledMessage: result.cancelledMessage
          }
        })

        const toolResults = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'tool_call_result'
        )
        runtime.assertThat(
          toolResults.length === 2 &&
            toolResults.some(
              (event) =>
                event.type === 'tool_call_result' &&
                typeof event.error === 'string' &&
                event.error.includes('cancelled by test')
            ),
          {
            name: 'terminal-cancel-tool-result-recorded',
            message: '取消分支也记录了 tool_call_result 事实事件',
            data: {
              toolResults: toolResults.length
            }
          }
        )
      }
    })
  })
})
