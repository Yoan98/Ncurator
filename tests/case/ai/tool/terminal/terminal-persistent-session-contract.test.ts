import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunResult = {
  terminalId: string
  terminalStatus: 'idle' | 'running' | 'stopping' | 'closed'
  returnReason: 'command_completed' | 'command_still_running'
  currentTerminalPath: string
  output: string
  outputCursor: number
  exitCode: number | null
}

type TerminalReadResult = {
  terminalId: string
  terminalStatus: 'idle' | 'running' | 'stopping' | 'closed'
  currentTerminalPath: string
  output: string
  outputCursor: number
  exitCode: number | null
}

type TerminalStopResult = {
  terminalId: string
  terminalStatus: 'idle' | 'running' | 'stopping' | 'closed'
  stopped: boolean
  forced: boolean
}

type TerminalFailureResult = { reason: string; error: string }

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-persistent-session-contract', async () => {
    await runBackendCase({
      caseId: 'terminal-persistent-session-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证真实持久终端保留当前路径、长命令让出控制权、增量读取和停止。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'nested'))
        const harness = createTerminalToolHarness(runtime, {}, { yieldMs: 150 })
        const changed = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows ? 'Set-Location nested' : 'cd nested'
        })
        const continued = await harness.invoke<TerminalRunResult>('terminal_run', {
          terminalId: changed.terminalId,
          command: isWindows ? 'Get-Location' : 'pwd'
        })
        const fresh = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows ? 'Get-Location' : 'pwd'
        })
        const running = await harness.invoke<TerminalRunResult>('terminal_run', {
          terminalId: changed.terminalId,
          command: isWindows
            ? 'while ($true) { Write-Output "terminal-tick"; Start-Sleep -Milliseconds 50 }'
            : 'while true; do echo terminal-tick; sleep 0.05; done'
        })
        const read = await harness.invoke<TerminalReadResult>('terminal_read', {
          terminalId: changed.terminalId,
          outputCursor: running.outputCursor
        })
        const stopped = await harness.invoke<TerminalStopResult>('terminal_stop', {
          terminalId: changed.terminalId
        })
        const detachedRejected = await harness.invoke<TerminalFailureResult>('terminal_run', {
          command: isWindows ? 'Start-Process powershell' : 'sleep 1 &'
        })
        const snapshots = harness.sessionManager.list({ chatSessionId: 'test-session' })
        await harness.release()
        return { changed, continued, fresh, running, read, stopped, detachedRejected, snapshots }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.changed.currentTerminalPath.endsWith(`${path.sep}nested`) &&
            result.continued.output.includes('nested') &&
            result.fresh.terminalId !== result.changed.terminalId &&
            result.fresh.currentTerminalPath === runtime.workspaceRoot,
          {
            name: 'persistent-terminal-keeps-cwd-and-isolates-new-session',
            message: '同一终端应保留 cd 后路径，新终端应从 workspace 根目录启动。',
            data: result
          }
        )
        runtime.assertThat(
          result.running.returnReason === 'command_still_running' &&
            result.running.terminalStatus === 'running' &&
            (result.running.output.includes('terminal-tick') ||
              result.read.output.includes('terminal-tick')) &&
            result.stopped.stopped &&
            result.stopped.terminalStatus === 'idle' &&
            result.detachedRejected.reason === 'invalid_input' &&
            result.detachedRejected.error.includes('detached shell execution') &&
            result.snapshots.some(
              (terminal) =>
                terminal.terminalId === result.changed.terminalId && terminal.status === 'idle'
            ),
          {
            name: 'persistent-terminal-yields-reads-and-stops',
            message: '长命令应固定让出控制权，允许读取增量输出并停止后返回空闲终端。',
            data: result
          }
        )
      }
    })
  })
})
