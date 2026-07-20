import type { AiRuntimePlatform } from '../../../../types'

export type TerminalEnvironmentInput = {
  platform: AiRuntimePlatform
  managerEnvironment?: Record<string, string>
  sessionEnvironment?: Record<string, string>
}

const inheritedEnvironment = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )

export const buildTerminalEnvironment = (
  input: TerminalEnvironmentInput
): Record<string, string> => {
  const environment = {
    ...inheritedEnvironment(),
    ...input.managerEnvironment,
    ...input.sessionEnvironment,
    TERM: 'xterm-256color'
  }

  if (input.platform === 'macos') {
    return {
      ...environment,
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      LC_CTYPE: 'en_US.UTF-8',
      PS1: '',
      PROMPT: '',
      RPROMPT: ''
    }
  }

  return {
    ...environment,
    PYTHONIOENCODING: 'utf-8',
    PYTHONUTF8: '1'
  }
}
