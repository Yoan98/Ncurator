import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

const execFileAsync = promisify(execFile)

type TerminalRunToolResult = {
  terminalId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  output: string
  error?: string
  sessions?: Array<{ terminalId: string; status: string; command: string }>
}

type TerminalStopToolResult = {
  terminalId: string
  status: 'stopped'
}

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-stop-and-session-limit', async () => {
    await runBackendCase({
      caseId: 'terminal-stop-and-session-limit',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description:
        '验证单轮并发上限错误能定位到具体会话、terminal_stop 可以释放额度，以及非交互默认环境生效。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const harness = createTerminalToolHarness(
          runtime,
          {},
          { yieldMs: 2_000, maxConcurrentSessions: 1, maxSessionsPerChat: 4 }
        )

        const running = await harness.invoke<TerminalRunToolResult>('terminal_run', {
          command: isWindows ? 'Start-Sleep -Seconds 8' : 'sleep 8'
        })
        const blocked = await harness.invoke<TerminalRunToolResult>('terminal_run', {
          command: 'echo blocked'
        })
        const stopped = await harness.invoke<TerminalStopToolResult>('terminal_stop', {
          terminalId: running.terminalId
        })
        const afterStop = await harness.invoke<TerminalRunToolResult>('terminal_run', {
          command: 'echo after-stop'
        })
        const environment = await harness.invoke<TerminalRunToolResult>('terminal_run', {
          command: isWindows
            ? 'Write-Output ("{0}|{1}" -f $env:GIT_PAGER, $env:CI)'
            : 'printf "%s|%s\\n" "$GIT_PAGER" "$CI"'
        })

        const pagerRepo = path.join(runtime.workspaceRoot, 'pager-repo')
        await fs.mkdir(pagerRepo, { recursive: true })
        await execFileAsync('git', ['init', '-q'], { cwd: pagerRepo })
        for (let index = 0; index < 40; index += 1) {
          await execFileAsync(
            'git',
            [
              '-c',
              'user.email=pager@example.test',
              '-c',
              'user.name=pager',
              'commit',
              '-q',
              '--allow-empty',
              '-m',
              `pager-${String(index)}`
            ],
            { cwd: pagerRepo }
          )
        }
        const pagedLog = await harness.invoke<TerminalRunToolResult>('terminal_run', {
          command: `git -C "${pagerRepo}" log`,
          maxWaitSeconds: 5
        })

        await harness.release()
        return { running, blocked, stopped, afterStop, environment, pagedLog }
      },
      assert: async (result, runtime) => {
        const blockedSessions = Array.isArray(result.blocked.sessions)
          ? result.blocked.sessions
          : []

        runtime.assertThat(
          result.running.status === 'running' &&
            result.blocked.error === 'terminal_session_limit_reached' &&
            blockedSessions.some((session) => session.terminalId === result.running.terminalId),
          {
            name: 'session-limit-error-lists-running-terminals',
            message: '达到单轮并发上限时，错误载荷应列出可回收的终端会话 ID。',
            data: {
              runningStatus: result.running.status,
              blockedError: result.blocked.error,
              sessions: blockedSessions
            }
          }
        )

        runtime.assertThat(
          result.stopped.terminalId === result.running.terminalId &&
            result.stopped.status === 'stopped' &&
            result.afterStop.status === 'succeeded' &&
            result.afterStop.output.includes('after-stop'),
          {
            name: 'terminal-stop-frees-the-slot',
            message: 'terminal_stop 应中断并关闭指定会话，随后同轮可以继续执行新命令。',
            data: {
              stopped: result.stopped,
              afterStop: { status: result.afterStop.status, output: result.afterStop.output }
            }
          }
        )

        runtime.assertThat(
          result.environment.status === 'succeeded' && result.environment.output.includes('cat|1'),
          {
            name: 'non-interactive-environment-defaults',
            message: '终端默认关闭 pager 并进入非交互模式，避免 git diff/log 等命令停在分页器。',
            data: {
              status: result.environment.status,
              output: result.environment.output
            }
          }
        )

        runtime.assertThat(
          result.pagedLog.status === 'succeeded' && result.pagedLog.output.includes('pager-39'),
          {
            name: 'git-log-does-not-stop-at-pager',
            message: '多屏 git log 应直接输出并结束，不等待分页器按键。',
            data: {
              status: result.pagedLog.status,
              output: result.pagedLog.output.slice(0, 500)
            }
          }
        )
      }
    })
  })
})
