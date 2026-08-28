import type { IPty } from 'node-pty'
import type { TerminalProtocol } from '../protocol/TerminalProtocol'
import type { TerminalPlatformAdapter } from './TerminalPlatformAdapter'

const encodeProtocolLiteral = (value: string): string =>
  Buffer.from(value, 'utf8').toString('base64')

const decodeProtocolLiteral = (value: string): string =>
  `$(printf '%s' '${encodeProtocolLiteral(value)}' | base64 -D)`

export class MacTerminalAdapter implements TerminalPlatformAdapter {
  public readonly platform = 'macos' as const
  public readonly shell = {
    executable: '/bin/zsh',
    args: ['-f'],
    lineEnding: '\n' as const
  }

  public buildBootstrapCommand(protocol: TerminalProtocol): string {
    return (
      [
        'stty -echo',
        "PROMPT=''; RPROMPT=''",
        `__ncurator_cwd_prefix="${decodeProtocolLiteral(protocol.cwdPrefix)}"`,
        `__ncurator_start_prefix="${decodeProtocolLiteral(protocol.startPrefix)}"`,
        `__ncurator_done_prefix="${decodeProtocolLiteral(protocol.donePrefix)}"`,
        `function chpwd() { local __ncurator_cwd=$(pwd | base64 | tr -d '\\n'); printf '%s%s__\\n' "$__ncurator_cwd_prefix" "$__ncurator_cwd"; }`,
        `printf '%s\\n' "${decodeProtocolLiteral(protocol.readyMarker)}"`
      ].join('; ') + this.shell.lineEnding
    )
  }

  public buildCommandEnvelope(commandId: string, commandFilePath: string): string {
    const encodedPath = Buffer.from(commandFilePath, 'utf8').toString('base64')
    return [
      `printf '%s%s__\\n' "$__ncurator_start_prefix" '${commandId}'`,
      `__ncurator_command_file="$(printf '%s' '${encodedPath}' | base64 -D)"`,
      `eval "$(command cat -- "$__ncurator_command_file")"`,
      '__ncurator_exit=$?',
      `__ncurator_cwd=$(pwd | base64 | tr -d '\\n')`,
      `printf '%s%s:%s:%s__\\n' "$__ncurator_done_prefix" '${commandId}' "$__ncurator_exit" "$__ncurator_cwd"`
    ].join('; ')
  }

  public buildStopProbe(commandId: string): string {
    return [
      `__ncurator_cwd=$(pwd | base64 | tr -d '\\n')`,
      `printf '%s%s:130:%s__\\n' "$__ncurator_done_prefix" '${commandId}' "$__ncurator_cwd"`
    ].join('; ')
  }

  public buildExitCommand(): string {
    return `exit${this.shell.lineEnding}`
  }

  public async resolveCommandCwd(): Promise<undefined> {
    return undefined
  }

  public async forceTerminate(process: IPty): Promise<void> {
    try {
      process.kill()
    } catch {
      // The PTY may have exited between the status check and kill.
    }
  }
}
