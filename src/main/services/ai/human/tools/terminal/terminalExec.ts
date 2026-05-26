import { spawn } from 'node:child_process'
import type { TerminalCommandInput, TerminalCommandResult } from './types'
import { getAiRuntimePlatform } from '../../../utils/platform'

export const runTerminalCommand = async (
  input: TerminalCommandInput
): Promise<TerminalCommandResult> => {
  const command = String(input.command || '').trim()
  const cwd = String(input.cwd || '').trim() || process.cwd()
  const timeoutMs = Math.max(500, Number(input.timeoutMs || 15000))
  const captureHardLimitChars = Math.max(256, Number(input.captureHardLimitChars || 120_000))

  if (!command) {
    return {
      command,
      cwd,
      stdout: '',
      stderr: 'empty command',
      exitCode: 1,
      signal: null,
      timedOut: false,
      durationMs: 0
    }
  }

  const startedAt = Date.now()
  const platform = getAiRuntimePlatform()
  const shellCommand =
    platform === 'windows' ? 'powershell.exe' : '/bin/zsh'
  const shellArgs =
    platform === 'windows'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]
      : ['-lc', command]

  return await new Promise<TerminalCommandResult>((resolve) => {
    const child = spawn(shellCommand, shellArgs, {
      cwd,
      shell: false,
      env: process.env,
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const appendChunk = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (!value) return

      if (target === 'stdout') stdout += value
      else stderr += value

      if (stdout.length + stderr.length > captureHardLimitChars) {
        stdout = stdout.slice(0, captureHardLimitChars)
        stderr = stderr.slice(0, Math.max(0, captureHardLimitChars - stdout.length))
        if (!settled) {
          child.kill('SIGTERM')
        }
      }
    }

    const done = (result: Omit<TerminalCommandResult, 'durationMs'>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        ...result,
        durationMs: Date.now() - startedAt
      })
    }

    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
    }, timeoutMs)

    child.stdout.on('data', (chunk) => appendChunk('stdout', chunk))
    child.stderr.on('data', (chunk) => appendChunk('stderr', chunk))

    child.on('error', (err) => {
      done({
        command,
        cwd,
        stdout,
        stderr: `${stderr}\n${err.message}`.trim(),
        exitCode: 1,
        signal: null,
        timedOut
      })
    })

    child.on('close', (exitCode, signal) => {
      done({
        command,
        cwd,
        stdout,
        stderr,
        exitCode,
        signal,
        timedOut
      })
    })
  })
}
