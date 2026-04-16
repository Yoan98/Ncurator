import type { AiRuntimePlatform } from '../types'

export const getAiRuntimePlatform = (): AiRuntimePlatform =>
  process.platform === 'win32' ? 'windows' : 'macos'
