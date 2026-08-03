import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiFileChangeRecord, AiRunEvent } from '../../../../../src/shared/types'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunResult = {
  terminalId: string
  terminalStatus: 'idle' | 'running' | 'stopping' | 'closed'
  executionStatus: 'running' | 'completed' | 'cancelled'
  output: string
  outputCursor: number
  exitCode: number | null
}

type TerminalReadResult = {
  terminalId: string
  terminalStatus: 'idle' | 'running' | 'stopping' | 'closed'
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

type TerminalFailureResult = { error: string }

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-persistent-session-contract', async () => {
    await runBackendCase({
      caseId: 'terminal-persistent-session-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description: '验证真实持久终端保留当前路径、命令级文件追踪、长命令让出控制权和停止。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'nested'))
        const harness = createTerminalToolHarness(runtime, {}, { yieldMs: 150 })
        const waitForIdle = async (initial: TerminalRunResult): Promise<TerminalRunResult> => {
          if (initial.terminalStatus !== 'running') return initial
          let output = initial.output
          let outputCursor = initial.outputCursor
          for (let attempt = 0; attempt < 60; attempt += 1) {
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
            const read = await harness.invoke<TerminalReadResult>('terminal_read', {
              terminalId: initial.terminalId,
              outputCursor
            })
            output += read.output
            outputCursor = read.outputCursor
            if (read.terminalStatus !== 'running') {
              return {
                ...initial,
                terminalStatus: read.terminalStatus,
                executionStatus: 'completed',
                output,
                outputCursor,
                exitCode: read.exitCode
              }
            }
          }
          throw new Error('terminal did not become idle')
        }
        const readUntilOutput = async (
          initial: TerminalRunResult,
          expected: string
        ): Promise<TerminalReadResult> => {
          let output = initial.output
          let outputCursor = initial.outputCursor
          for (let attempt = 0; attempt < 60; attempt += 1) {
            if (output.includes(expected)) {
              return {
                terminalId: initial.terminalId,
                terminalStatus: initial.terminalStatus,
                output,
                outputCursor,
                exitCode: initial.exitCode
              }
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
            const read = await harness.invoke<TerminalReadResult>('terminal_read', {
              terminalId: initial.terminalId,
              outputCursor
            })
            output += read.output
            outputCursor = read.outputCursor
            if (read.terminalStatus !== 'running' || output.includes(expected)) {
              return { ...read, output, outputCursor }
            }
          }
          throw new Error(`terminal output did not include ${expected}`)
        }
        const waitForTrackedRecords = async (
          fileNames: readonly string[]
        ): Promise<AiFileChangeRecord[]> => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const records = await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
            if (fileNames.every((fileName) => records.some((record) => record.fileName === fileName))) {
              return records
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(`terminal change records were not saved: ${fileNames.join(', ')}`)
        }
        const changed = await waitForIdle(
          await harness.invoke<TerminalRunResult>('terminal_run', {
            command: isWindows ? 'Set-Location nested' : 'cd nested'
          })
        )
        const continued = await waitForIdle(
          await harness.invoke<TerminalRunResult>('terminal_run', {
            terminalId: changed.terminalId,
            command: isWindows ? 'Get-Location' : 'pwd'
          })
        )
        const fresh = await waitForIdle(
          await harness.invoke<TerminalRunResult>('terminal_run', {
            command: isWindows ? 'Get-Location' : 'pwd'
          })
        )
        const completedLongCommand = await waitForIdle(
          await harness.invoke<TerminalRunResult>('terminal_run', {
            terminalId: changed.terminalId,
            command: isWindows
              ? 'Set-Content -LiteralPath ..\\completed-from-nested.txt -Value completed; Start-Sleep -Milliseconds 500'
              : 'printf "completed\\n" > ../completed-from-nested.txt; sleep 0.5'
          })
        )
        const snapshotsBeforeStop = harness.sessionManager.list({ chatSessionId: 'test-session' })
        const running = await harness.invoke<TerminalRunResult>('terminal_run', {
          terminalId: changed.terminalId,
          command: isWindows
            ? 'Set-Content -LiteralPath ..\\stopped-from-nested.txt -Value stopped; while ($true) { Write-Output "terminal-tick"; Start-Sleep -Milliseconds 50 }'
            : 'printf "stopped\\n" > ../stopped-from-nested.txt; while true; do echo terminal-tick; sleep 0.05; done'
        })
        const read = await readUntilOutput(running, 'terminal-tick')
        const stopped = await harness.invoke<TerminalStopResult>('terminal_stop', {
          terminalId: changed.terminalId
        })
        const nonZero = await waitForIdle(
          await harness.invoke<TerminalRunResult>('terminal_run', {
            terminalId: changed.terminalId,
            command: isWindows
              ? 'Set-Content -LiteralPath ..\\nonzero-from-nested.txt -Value nonzero; cmd /c exit 1'
              : 'printf "nonzero\\n" > ../nonzero-from-nested.txt; false'
          })
        )
        const records = await waitForTrackedRecords([
          'completed-from-nested.txt',
          'stopped-from-nested.txt',
          'nonzero-from-nested.txt'
        ])
        const artifactEvents = runtime.eventCollector
          .snapshot()
          .filter((event): event is Extract<AiRunEvent, { type: 'file_artifact' }> =>
            event.type === 'file_artifact'
          )
        const detachedRejected = await harness.invoke<TerminalFailureResult>('terminal_run', {
          command: isWindows ? 'Start-Process powershell' : 'sleep 1 &'
        })
        const snapshotsAfterStop = harness.sessionManager.list({ chatSessionId: 'test-session' })
        await harness.release()
        return {
          changed,
          continued,
          fresh,
          completedLongCommand,
          running,
          read,
          stopped,
          nonZero,
          records,
          artifactEvents,
          detachedRejected,
          snapshotsBeforeStop,
          snapshotsAfterStop
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.continued.output.includes('nested') &&
            result.fresh.terminalId !== result.changed.terminalId &&
            result.snapshotsBeforeStop.some(
              (terminal) =>
                terminal.terminalId === result.changed.terminalId &&
                terminal.currentTerminalPath.endsWith(`${path.sep}nested`)
            ) &&
            result.snapshotsBeforeStop.some(
              (terminal) =>
                terminal.terminalId === result.fresh.terminalId &&
                terminal.currentTerminalPath === runtime.workspaceRoot
            ),
          {
            name: 'persistent-terminal-keeps-cwd-and-isolates-new-session',
            message: '同一终端应保留 cd 后路径，新终端应从 workspace 根目录启动。',
            data: result
          }
        )
        runtime.assertThat(
          result.running.executionStatus === 'running' &&
            result.running.terminalStatus === 'running' &&
            (result.running.output.includes('terminal-tick') ||
              result.read.output.includes('terminal-tick')) &&
            result.stopped.stopped &&
            result.detachedRejected.error.includes('detached shell execution') &&
            (result.stopped.forced
              ? result.stopped.terminalStatus === 'closed' &&
                !result.snapshotsAfterStop.some(
                  (terminal) => terminal.terminalId === result.changed.terminalId
                )
              : result.stopped.terminalStatus === 'idle' &&
                result.snapshotsAfterStop.some(
                  (terminal) =>
                    terminal.terminalId === result.changed.terminalId && terminal.status === 'idle'
                )),
          {
            name: 'persistent-terminal-yields-reads-and-stops',
            message: '长命令应固定让出控制权，允许读取增量输出并停止后返回空闲终端。',
            data: result
          }
        )
        const trackedFileNames = new Set(result.records.map((record) => record.fileName))
        const artifactFileNames = new Set(result.artifactEvents.map((event) => event.fileName))
        runtime.assertThat(
          result.completedLongCommand.executionStatus === 'completed' &&
            result.nonZero.executionStatus === 'completed' &&
            result.nonZero.exitCode === 1 &&
            ['completed-from-nested.txt', 'stopped-from-nested.txt', 'nonzero-from-nested.txt'].every(
              (fileName) => trackedFileNames.has(fileName) && artifactFileNames.has(fileName)
            ) &&
            result.records
              .filter((record) => trackedFileNames.has(record.fileName))
              .every((record) => record.source === 'terminal_tool' && record.runId === runtime.runId),
          {
            name: 'persistent-terminal-finalizes-command-scoped-file-changes',
            message:
              '长命令完成、停止和非零退出都必须按命令窗口保存文件变化并发出当前 run 的 artifact。',
            data: {
              completedLongCommand: result.completedLongCommand,
              stopped: result.stopped,
              nonZero: result.nonZero,
              records: result.records,
              artifactEvents: result.artifactEvents
            }
          }
        )
      }
    })
  })
})
