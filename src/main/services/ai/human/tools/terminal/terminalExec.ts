import { spawn } from 'node:child_process'
import type { TerminalCommandInput, TerminalCommandResult } from './types'
import { getAiRuntimePlatform } from '../../../utils/platform'

export type TerminalUnusableOutputSignature =
  | 'NUL'
  | 'PK_HEADER'
  | 'PDF_HEADER'
  | 'OFFICE_WORD_XML'
  | 'OFFICE_EXCEL_XML'
  | 'OFFICE_POWERPOINT_XML'
  | 'REPLACEMENT_CHAR_RATIO'
  | 'CONTROL_CHAR_RATIO'

export type TerminalOutputQualityReport = {
  unusable: boolean
  totalChars: number
  nulCount: number
  replacementCharCount: number
  replacementCharRatio: number
  controlCharCount: number
  controlCharRatio: number
  matchedSignatures: TerminalUnusableOutputSignature[]
}

const MIN_RATIO_CHECK_CHARS = 100
const UNUSABLE_RATIO_THRESHOLD = 0.15

const countMatches = (value: string, pattern: RegExp): number =>
  Array.from(value.matchAll(pattern)).length

const countC0ControlChars = (value: string): number => {
  let count = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x1f && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      count += 1
    }
  }
  return count
}

const roundRatio = (value: number): number => Number(value.toFixed(4))

export const inspectTerminalOutputQuality = (
  stdout: string,
  stderr: string
): TerminalOutputQualityReport => {
  const output = `${stdout || ''}${stderr || ''}`
  const totalChars = output.length
  const nulCount = countMatches(output, /\u0000/g)
  const replacementCharCount = countMatches(output, /\uFFFD/g)
  const controlCharCount = countC0ControlChars(output)
  const replacementCharRatio = totalChars > 0 ? replacementCharCount / totalChars : 0
  const controlCharRatio = totalChars > 0 ? controlCharCount / totalChars : 0
  const matchedSignatures: TerminalUnusableOutputSignature[] = []

  if (nulCount > 0) matchedSignatures.push('NUL')
  if (output.includes('PK\u0003\u0004')) matchedSignatures.push('PK_HEADER')
  if (output.includes('%PDF-')) matchedSignatures.push('PDF_HEADER')
  if (output.includes('word/document.xml')) matchedSignatures.push('OFFICE_WORD_XML')
  if (output.includes('xl/workbook.xml')) matchedSignatures.push('OFFICE_EXCEL_XML')
  if (output.includes('ppt/presentation.xml')) matchedSignatures.push('OFFICE_POWERPOINT_XML')
  if (totalChars >= MIN_RATIO_CHECK_CHARS && replacementCharRatio >= UNUSABLE_RATIO_THRESHOLD) {
    matchedSignatures.push('REPLACEMENT_CHAR_RATIO')
  }
  if (totalChars >= MIN_RATIO_CHECK_CHARS && controlCharRatio >= UNUSABLE_RATIO_THRESHOLD) {
    matchedSignatures.push('CONTROL_CHAR_RATIO')
  }

  return {
    unusable: matchedSignatures.length > 0,
    totalChars,
    nulCount,
    replacementCharCount,
    replacementCharRatio: roundRatio(replacementCharRatio),
    controlCharCount,
    controlCharRatio: roundRatio(controlCharRatio),
    matchedSignatures
  }
}

export const buildWindowsPowerShellEncodedCommand = (command: string): string => {
  const wrappedCommand = [
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    command
  ].join('\n')
  return Buffer.from(wrappedCommand, 'utf16le').toString('base64')
}

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
  const shellCommand = platform === 'windows' ? 'powershell.exe' : '/bin/zsh'
  const shellArgs =
    platform === 'windows'
      ? [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          buildWindowsPowerShellEncodedCommand(command)
        ]
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
