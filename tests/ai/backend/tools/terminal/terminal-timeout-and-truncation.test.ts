import { describe, it } from 'vitest'
import type { AiRunEvent } from '../../../../../src/shared/types'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'

type TerminalRunResult = {
  ok: boolean
  code: string
  command: string
  outputPreview: string
  exitCode: number | null
  timedOut: boolean
  truncated: boolean
  error?: string
}

describe('terminal timeout and truncation', () => {
  it('records timeout and long-output truncation as factual terminal failures', async () => {
    await runBackendCase({
      caseId: 'terminal-timeout-and-truncation',
      caseType: 'scenario',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['terminal'],
      description: '验证 terminal capability 对超时和长输出截断的处理',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const timeoutHarness = createTerminalToolHarness(
          runtime,
          {},
          {
            timeoutMs: 200,
            maxOutputChars: 2000,
            safePreviewChars: 120
          }
        )
        const truncationHarness = createTerminalToolHarness(
          runtime,
          {},
          {
            timeoutMs: 2000,
            maxOutputChars: 300,
            safePreviewChars: 120
          }
        )

        const timedOutResult = await timeoutHarness.invoke<TerminalRunResult>('terminal_run_command', {
          command: `node -e "setTimeout(() => process.stdout.write('done'), 1000)"`
        })
        const truncatedResult = await truncationHarness.invoke<TerminalRunResult>(
          'terminal_run_command',
          {
            command: `node -e "process.stdout.write('x'.repeat(2000))"`
          }
        )

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-timeout-and-truncation',
          status: 'ok',
          message: 'terminal timeout 与长输出截断路径已经执行',
          data: {
            timedOut: timedOutResult.timedOut,
            timeoutCode: timedOutResult.code,
            truncated: truncatedResult.truncated,
            truncatedCode: truncatedResult.code
          }
        })

        return {
          timedOutResult,
          truncatedResult,
          aiEvents: runtime.eventCollector.snapshot()
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.timedOutResult.ok === false &&
            result.timedOutResult.code === 'failed' &&
            result.timedOutResult.timedOut,
          {
            name: 'terminal-timeout-result',
            message: '超时命令返回 failed 且 timedOut=true',
            data: {
              code: result.timedOutResult.code,
              timedOut: result.timedOutResult.timedOut
            }
          }
        )
        runtime.assertThat(
          result.truncatedResult.ok === false &&
            result.truncatedResult.code === 'failed' &&
            result.truncatedResult.truncated,
          {
            name: 'terminal-truncated-result',
            message: '长输出命令返回 failed 且 truncated=true',
            data: {
              code: result.truncatedResult.code,
              truncated: result.truncatedResult.truncated
            }
          }
        )
        runtime.assertThat(result.truncatedResult.outputPreview.length <= 120, {
          name: 'terminal-truncated-preview-clipped',
          message: '长输出命令的 outputPreview 已按 safePreviewChars 截断',
          data: {
            previewLength: result.truncatedResult.outputPreview.length
          }
        })

        const stepErrors = result.aiEvents.filter(
          (event: AiRunEvent) => event.type === 'terminal_step_error'
        )
        runtime.assertThat(stepErrors.length === 2, {
          name: 'terminal-timeout-truncation-step-errors',
          message: 'timeout 与 truncation 都记录了 terminal_step_error',
          data: {
            stepErrors: stepErrors.length
          }
        })
      }
    })
  })
})
