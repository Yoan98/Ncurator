import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'vitest'
import { createTerminalToolHarness } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type TerminalRunResult = {
  terminalId: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
}

type TerminalReadResult = {
  status: 'running' | 'succeeded' | 'failed' | 'cancelled'
  output: string
  readEndPosition: number
  hasMoreOutput: boolean
}

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
        '验证真实终端在隔离工作目录执行命令、长命令让出控制权并可增量读取、退出码与分离执行。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        await fs.mkdir(path.join(runtime.workspaceRoot, 'nested'))
        const harness = createTerminalToolHarness(runtime, {}, { yieldMs: 2000 })

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
        let completedRead = read
        for (let attempt = 0; attempt < 60 && completedRead.status === 'running'; attempt += 1) {
          await new Promise<void>((resolve) => setTimeout(resolve, 50))
          completedRead = await harness.invoke<TerminalReadResult>('terminal_read', {
            terminalId: running.terminalId,
            readEndPosition: completedRead.readEndPosition
          })
        }
        const nonZero = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows
            ? 'Set-Content -LiteralPath terminal-nonzero.txt -Value nonzero; cmd /c exit 1'
            : 'printf "nonzero\\n" > terminal-nonzero.txt; false'
        })
        const detachedAllowed = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows
            ? 'Start-Process -FilePath cmd.exe -ArgumentList "/c","echo detached-ok" -Wait -NoNewWindow; Write-Output detached-ok'
            : 'sleep 0.2 & wait; echo detached-ok'
        })
        const redirectAllowed = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: 'echo redirect-ok 2>&1'
        })
        const watchedStartedAt = Date.now()
        const watched = await harness.invoke<TerminalRunResult>('terminal_run', {
          command: isWindows ? 'Start-Sleep -Seconds 8' : 'sleep 8',
          maxWaitSeconds: 1
        })
        const watchedElapsedMs = Date.now() - watchedStartedAt
        await harness.release()
        const writtenFiles = {
          completed: await fs.readFile(
            path.join(runtime.workspaceRoot, 'terminal-completed.txt'),
            'utf8'
          ),
          running: await fs.readFile(
            path.join(runtime.workspaceRoot, 'terminal-running.txt'),
            'utf8'
          ),
          nonzero: await fs.readFile(
            path.join(runtime.workspaceRoot, 'terminal-nonzero.txt'),
            'utf8'
          )
        }
        const fileChangeRecords = await harness.ctx.listFileChangeRecords({ runId: runtime.runId })
        return {
          pwdAtRoot,
          cdNested,
          completedFile,
          running,
          read,
          completedRead,
          nonZero,
          detachedAllowed,
          redirectAllowed,
          watched,
          watchedElapsedMs,
          writtenFiles,
          fileChangeRecords
        }
      },
      assert: async (result, runtime) => {
        runtime.assertThat(
          result.pwdAtRoot.status === 'succeeded' &&
            result.pwdAtRoot.output.length > 0 &&
            result.cdNested.status === 'succeeded' &&
            result.cdNested.output.includes('nested'),
          {
            name: 'terminal-runs-from-workspace-root',
            message: '终端应从工作区根目录执行命令，并可在单条命令内 cd 切换目录。',
            data: result
          }
        )
        runtime.assertThat(
          result.running.status === 'running' &&
            result.completedRead.status === 'succeeded' &&
            (result.running.output.includes('terminal-tick') ||
              result.read.output.includes('terminal-tick')) &&
            result.detachedAllowed.status === 'succeeded' &&
            result.detachedAllowed.output.includes('detached-ok'),
          {
            name: 'terminal-yields-reads-and-allows-detached',
            message:
              '长命令应固定让出控制权并允许增量读取；后台分离执行（& / Start-Process）应可正常完成。',
            data: result
          }
        )
        runtime.assertThat(
          result.watched.status === 'running' &&
            result.watchedElapsedMs >= 800 &&
            // 发布门禁并发下 PowerShell 启动抖动可能超过 1.8s；关键是未等到 8s sleep 结束就让出。
            result.watchedElapsedMs < 5_000,
          {
            name: 'terminal-max-wait-yields-without-stopping',
            message: 'maxWaitSeconds 到点后本次调用不再盯，命令继续执行。',
            data: {
              status: result.watched.status,
              watchedElapsedMs: result.watchedElapsedMs,
              output: result.watched.output
            }
          }
        )
        runtime.assertThat(
          result.redirectAllowed.status === 'succeeded' &&
            result.redirectAllowed.output.includes('redirect-ok') &&
            result.nonZero.status === 'failed' &&
            result.writtenFiles.completed.includes('completed') &&
            result.writtenFiles.running.includes('running') &&
            result.writtenFiles.nonzero.includes('nonzero') &&
            result.fileChangeRecords.length === 0,
          {
            name: 'terminal-returns-status-writes-files-without-apply-records',
            message:
              '命令应返回 succeeded/failed 状态，写文件只落磁盘，不产生修改记录；带 2>&1 的验证命令应正常执行。',
            data: result
          }
        )
      }
    })
  })
})
