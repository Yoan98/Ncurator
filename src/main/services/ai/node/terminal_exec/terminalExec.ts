import { spawn } from 'node:child_process'

export type TerminalCommandInput = {
  command: string
  cwd: string
  timeoutMs: number
  maxOutputChars: number
}

export type TerminalCommandResult = {
  command: string
  cwd: string
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  truncated: boolean
  durationMs: number
}

const clipText = (text: string, maxChars: number) => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return { text: raw, truncated: false }
  return { text: raw.slice(0, maxChars), truncated: true }
}

export const runTerminalCommand = async (
  input: TerminalCommandInput
): Promise<TerminalCommandResult> => {
  const command = String(input.command || '').trim()
  const cwd = String(input.cwd || '').trim() || process.cwd()
  const timeoutMs = Math.max(500, Number(input.timeoutMs || 15000))
  const maxOutputChars = Math.max(256, Number(input.maxOutputChars || 8000))

  if (!command) {
    return {
      command,
      cwd,
      stdout: '',
      stderr: 'empty command',
      exitCode: 1,
      signal: null,
      timedOut: false,
      truncated: false,
      durationMs: 0
    }
  }

  const startedAt = Date.now()

  return await new Promise<TerminalCommandResult>((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: process.env
    })

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let truncated = false
    let settled = false

    const appendChunk = (target: 'stdout' | 'stderr', chunk: Buffer | string) => {
      const value = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (!value) return

      if (target === 'stdout') stdout += value
      else stderr += value

      if (stdout.length + stderr.length > maxOutputChars) {
        const clipped = clipText(stdout + stderr, maxOutputChars)
        stdout = clipped.text
        stderr = ''
        truncated = clipped.truncated
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
        timedOut,
        truncated
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
        timedOut,
        truncated
      })
    })
  })
}
