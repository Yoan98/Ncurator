import path from 'node:path'
import { stat } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import type { IPty } from 'node-pty'
import type { TerminalProtocol } from '../protocol/TerminalProtocol'
import type { ResolveCommandCwdInput, TerminalPlatformAdapter } from './TerminalPlatformAdapter'

const LEADING_CWD_PATTERN = /^\s*(?:cd|Set-Location)\s+(?:"([^"]+)"|'([^']+)'|([^\s;]+))\s*;/iu

const encodeProtocolLiteral = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64')

const decodeProtocolLiteral = (value: string): string =>
  `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodeProtocolLiteral(value)}'))`

export class WindowsTerminalAdapter implements TerminalPlatformAdapter {
  public readonly platform = 'windows' as const
  public readonly shell = {
    executable: 'powershell.exe',
    args: ['-NoLogo', '-NoProfile'],
    lineEnding: '\r' as const
  }

  public buildBootstrapCommand(protocol: TerminalProtocol): string {
    return (
      [
        '$__ncurator_utf8 = [System.Text.UTF8Encoding]::new($false)',
        '[Console]::InputEncoding = $__ncurator_utf8',
        '[Console]::OutputEncoding = $__ncurator_utf8',
        '$OutputEncoding = $__ncurator_utf8',
        'chcp.com 65001 > $null',
        `$global:__ncurator_cwd_prefix = ${decodeProtocolLiteral(protocol.cwdPrefix)}`,
        `$global:__ncurator_start_prefix = ${decodeProtocolLiteral(protocol.startPrefix)}`,
        `$global:__ncurator_done_prefix = ${decodeProtocolLiteral(protocol.donePrefix)}`,
        `function global:Set-Location { param([Parameter(Position=0)][string]$Path) Microsoft.PowerShell.Management\\Set-Location -Path $Path; $__cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path)); Write-Output ($global:__ncurator_cwd_prefix + $__cwd + '__') }`,
        `Write-Output (${decodeProtocolLiteral(protocol.readyMarker)})`
      ].join('; ') + this.shell.lineEnding
    )
  }

  public buildCommandEnvelope(commandId: string, commandFilePath: string): string {
    return [
      `Write-Output ($global:__ncurator_start_prefix + '${commandId}__')`,
      `$__ncurator_command_file = ${decodeProtocolLiteral(commandFilePath)}`,
      '$__ncurator_command = [IO.File]::ReadAllText($__ncurator_command_file, [Text.Encoding]::UTF8)',
      '$global:LASTEXITCODE = $null',
      '$__ncurator_errors = @()',
      'Invoke-Expression $__ncurator_command -ErrorVariable +__ncurator_errors',
      '$__ncurator_succeeded = $? -and $__ncurator_errors.Count -eq 0',
      '$__ncurator_exit = if ($null -ne $LASTEXITCODE) { $LASTEXITCODE } elseif ($__ncurator_succeeded) { 0 } else { 1 }',
      '$__ncurator_cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))',
      `$__ncurator_marker = $global:__ncurator_done_prefix + '${commandId}:' + $__ncurator_exit + ':' + $__ncurator_cwd + '__'`,
      'Write-Output $__ncurator_marker'
    ].join('; ')
  }

  public buildStopProbe(commandId: string): string {
    return [
      '$__ncurator_cwd = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))',
      `$__ncurator_marker = $global:__ncurator_done_prefix + '${commandId}:130:' + $__ncurator_cwd + '__'`,
      'Write-Output $__ncurator_marker'
    ].join('; ')
  }

  public buildExitCommand(): string {
    return `exit${this.shell.lineEnding}`
  }

  public async resolveCommandCwd(input: ResolveCommandCwdInput): Promise<string | undefined> {
    const match = input.command.match(LEADING_CWD_PATTERN)
    if (!match) return undefined
    const requestedPath = match[1] || match[2] || match[3]
    if (!requestedPath) return undefined
    const nextPath = path.resolve(input.currentPath, requestedPath)
    try {
      return (await stat(nextPath)).isDirectory() ? nextPath : undefined
    } catch {
      return undefined
    }
  }

  public async forceTerminate(process: IPty): Promise<void> {
    await new Promise<void>((resolve) => {
      execFile(
        'taskkill.exe',
        ['/PID', String(process.pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve()
      )
    })
  }
}
