import type { AiRuntimePlatform } from '../../../../types'
import { MacTerminalAdapter } from './MacTerminalAdapter'
import type { TerminalPlatformAdapter } from './TerminalPlatformAdapter'
import { WindowsTerminalAdapter } from './WindowsTerminalAdapter'

const adapters: Record<AiRuntimePlatform, TerminalPlatformAdapter> = {
  macos: new MacTerminalAdapter(),
  windows: new WindowsTerminalAdapter()
}

export const getTerminalPlatformAdapter = (platform: AiRuntimePlatform): TerminalPlatformAdapter =>
  adapters[platform]

export type { TerminalPlatformAdapter } from './TerminalPlatformAdapter'
