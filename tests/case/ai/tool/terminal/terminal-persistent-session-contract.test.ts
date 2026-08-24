import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import type { AiFileChangeRecord, AiRunEvent } from '../../../../../src/shared/types'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunResult = {
  terminalId: string
  status: 'running' | 'completed' | 'cancelled'
  output: string
  readEndPosition: number
  exitCode: number | null
}

type TerminalReadResult = {
  terminalId: string
  status: 'running' | 'completed' | 'cancelled'
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
  exitCode: number | null
}

type TerminalFailureResult = { error: string }

const isWindows = process.platform === 'win32'

describe('ai tool terminal backend', () => {
  it('terminal-execution-contract', async () => {
    await runBackendCase({
      caseId: 'terminal-execution-contract',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['terminal'],
      description:
        '验证终端在工作区根目录执行命令、长命令让出控制权并可增量读取、文件追踪与退出码。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'nested'))
        const harness = createTerminalToolHarness(runtime, {}, { yieldMs: 2000 })

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
        const waitForArtifactEvents = async (
          fileNames: readonly string[]
        ): Promise<Extract<AiRunEvent, { type: 'file_artifact' }>[]> => {
          for (let attempt = 0; attempt < 60; attempt += 1) {
            const events = runtime.eventCollector
              .snapshot()
              .filter((event): event is Extract<AiRunEvent, { type: 'file_artifact' }> =>
                event.type === 'file_artifact'
              )
            if (fileNames.every((fileName) => events.some((event) => event.fileName === fileName))) {
              return events
            }
            await new Promise<void>((resolve) => setTimeout(resolve, 50))
          }
          throw new Error(`terminal artifact events were not emitted: ${fileNames.join(', ')}`)
        }

        const pwdAtRoot = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows ? 'Get-Location' : 'pwd'
        })
        const cdNested = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows ? 'Set-Location nested; Get-Location' : 'cd nested; pwd'
        })
        const completedFile = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows
            ? 'Set-Content -LiteralPath terminal-completed.txt -Value completed; Start-Sleep -Milliseconds 400'
            : 'printf "completed\\n" > terminal-completed.txt; sleep 0.4'
        })
        const running = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows
            ? 'Set-Content -LiteralPath terminal-running.txt -Value running; for ($i=0; $i -lt 5; $i++) { Write-Output "terminal-tick"; Start-Sleep -Milliseconds 500 }'
            : 'printf "running\\n" > terminal-running.txt; for i in 1 2 3 4 5; do echo terminal-tick; sleep 0.5; done'
        })
        const read = await harness.invoke<TerminalReadResult>('terminal_read', {
          terminalId: running.terminalId,
          readEndPosition: running.readEndPosition
        })
        const nonZero = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows
            ? 'Set-Content -LiteralPath terminal-nonzero.txt -Value nonzero; cmd /c exit 1'
            : 'printf "nonzero\\n" > terminal-nonzero.txt; false'
        })
        const detachedRejected = await harness.invoke<TerminalFailureResult>('terminal_run', {
          command: isWindows ? 'Start-Process powershell' : 'sleep 1 &'
        })
        const redirectAllowed = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: 'echo redirect-ok 2>&1'
        })
        const trackedFileNames = ['terminal-completed.txt', 'terminal-nonzero.txt'] as const
        const records = await waitForTrackedRecords(trackedFileNames)
        const artifactEvents = await waitForArtifactEvents(trackedFileNames)
        await harness.release()
        return {
          pwdAtRoot,
          cdNested,
          completedFile,
          running,
          read,
          nonZero,
          detachedRejected,
          redirectAllowed,
          records,
          artifactEvents
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.pwdAtRoot.status === 'completed' &&
            result.pwdAtRoot.output.length > 0 &&
            result.cdNested.status === 'completed' &&
            result.cdNested.output.includes('nested'),
          {
            name: 'terminal-runs-from-workspace-root',
            message: '终端应从工作区根目录执行命令，并可在单条命令内 cd 切换目录。',
            data: result
          }
        )
        runtime.assertThat(
          result.running.status === 'running' &&
            (result.running.output.includes('terminal-tick') ||
              result.read.output.includes('terminal-tick')) &&
            result.detachedRejected.error.includes('detached shell execution'),
          {
            name: 'terminal-yields-and-reads-long-commands',
            message: '长命令应固定让出控制权，并允许增量读取输出；分离执行应被拒绝。',
            data: result
          }
        )
        runtime.assertThat(
          result.redirectAllowed.status === 'completed' &&
            result.redirectAllowed.exitCode === 0 &&
            result.redirectAllowed.output.includes('redirect-ok') &&
            result.nonZero.status === 'completed' &&
            result.nonZero.exitCode === 1,
          {
            name: 'terminal-returns-exit-codes-and-allows-fd-merge-redirection',
            message: '命令应返回正确退出码，带 2>&1 fd 合并重定向的验证命令应正常执行。',
            data: result
          }
        )
        const trackedFileNames = new Set(result.records.map((record) => record.fileName))
        const artifactFileNames = new Set(result.artifactEvents.map((event) => event.fileName))
        runtime.assertThat(
          ['terminal-completed.txt', 'terminal-nonzero.txt'].every(
            (fileName) => trackedFileNames.has(fileName) && artifactFileNames.has(fileName)
          ) &&
            result.records
              .filter((record) => trackedFileNames.has(record.fileName))
              .every((record) => record.source === 'terminal_tool' && record.runId === runtime.runId),
          {
            name: 'terminal-finalizes-command-scoped-file-changes',
            message: '命令完成和非零退出都必须按命令窗口保存文件变化并发出当前 run 的 artifact。',
            data: {
              records: result.records,
              artifactEvents: result.artifactEvents
            }
          }
        )
      }
    })
  })
})
