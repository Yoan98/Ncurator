import type { IPty } from 'node-pty'
import type { AiRuntimePlatform } from '../../../../types'
import type { TerminalProtocol } from '../protocol/TerminalProtocol'

export type TerminalShellConfig = {
  executable: string
  args: string[]
  lineEnding: '\n' | '\r'
}

export type ResolveCommandCwdInput = {
  command: string
  currentPath: string
  allowedRootPaths: readonly string[]
}

export interface TerminalPlatformAdapter {
  readonly platform: AiRuntimePlatform
  readonly shell: TerminalShellConfig
  buildBootstrapCommand(protocol: TerminalProtocol): string
  buildCommandEnvelope(commandId: string, commandFilePath: string): string
  buildStopProbe(commandId: string): string
  buildExitCommand(): string
  resolveCommandCwd(input: ResolveCommandCwdInput): Promise<string | undefined>
  forceTerminate(process: IPty): Promise<void>
}
