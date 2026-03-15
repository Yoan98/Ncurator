import path from 'node:path'
import { describe, it } from 'vitest'
import { runTerminalCommand } from '../../../../../src/main/services/ai/tools/terminal_exec/terminalExec'
import {
  checkWorkspaceBoundary,
  classifyCommandRisk
} from '../../../../../src/main/services/ai/tools/terminal_exec/terminalPolicy'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('terminal basic command', () => {
  it('executes a low-risk terminal command and writes factual logs', async () => {
    await runBackendCase({
      caseId: 'terminal-basic-command',
      caseType: 'basic',
      domain: 'ai',
      layer: 'backend',
      suite: 'tools',
      groups: ['terminal'],
      description: '验证 terminal capability 能执行低风险命令并产出事实日志',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const command = "printf 'terminal capability ok'"
        const cwd = path.resolve(runtime.workspaceRoot)
        const boundary = checkWorkspaceBoundary(command, runtime.workspaceRoot)
        const riskLevel = classifyCommandRisk(command)

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-command-start',
          status: 'info',
          message: `准备执行 terminal 命令：${command}`,
          data: {
            command,
            cwd,
            riskLevel
          }
        })

        runtime.assertThat(boundary.ok, {
          name: 'workspace-boundary-check',
          message: 'workspace boundary check 通过'
        })
        runtime.assertThat(riskLevel === 'low', {
          name: 'terminal-risk-low',
          message: 'terminal risk classification 为 low',
          data: {
            riskLevel
          }
        })

        const result = await runTerminalCommand({
          command,
          cwd,
          timeoutMs: 5000,
          maxOutputChars: 2000
        })

        runtime.recordEvent({
          type: 'step',
          name: 'terminal-command-result',
          status: result.exitCode === 0 && !result.timedOut ? 'ok' : 'failed',
          message:
            result.exitCode === 0 && !result.timedOut
              ? 'terminal 命令执行成功'
              : 'terminal 命令执行失败',
          data: {
            command: result.command,
            exitCode: result.exitCode,
            timedOut: result.timedOut,
            stdout: result.stdout.trim(),
            stderr: result.stderr.trim()
          }
        })

        return result
      },
      assert: async (result, runtime) => {
        runtime.assertThat(result.exitCode === 0, {
          name: 'terminal-exit-code-zero',
          message: 'terminal 命令退出码为 0',
          data: {
            exitCode: result.exitCode
          }
        })
        runtime.assertThat(result.timedOut === false, {
          name: 'terminal-not-timed-out',
          message: 'terminal 命令未超时'
        })
        runtime.assertThat(result.stdout.trim() === 'terminal capability ok', {
          name: 'terminal-stdout-match',
          message: 'terminal 输出符合预期',
          data: {
            stdout: result.stdout.trim()
          }
        })
      }
    })
  })
})
