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

// AI 终端必须能自己退出：关闭分页器、编辑器与 Git 凭据提示，避免常见交互把命令挂住。
// 放在继承环境之后，避免宿主进程里的 PAGER 等反过来影响 AI 终端；显式 manager / session
// 覆盖仍然优先，保留调试和特殊场景的逃生口。
const NON_INTERACTIVE_ENVIRONMENT = {
  PAGER: 'cat',
  GIT_PAGER: 'cat',
  GH_PAGER: 'cat',
  MANPAGER: 'cat',
  SYSTEMD_PAGER: 'cat',
  BAT_PAGER: 'cat',
  LESS: 'FRX',
  GIT_EDITOR: ':',
  GIT_SEQUENCE_EDITOR: ':',
  GIT_MERGE_AUTOEDIT: 'no',
  GIT_TERMINAL_PROMPT: '0',
  CI: '1',
  npm_config_yes: 'true',
  HOMEBREW_NO_AUTO_UPDATE: '1',
  PYTHONUNBUFFERED: '1'
} as const

export const buildTerminalEnvironment = (
  input: TerminalEnvironmentInput
): Record<string, string> => {
  const environment = {
    ...inheritedEnvironment(),
    ...NON_INTERACTIVE_ENVIRONMENT,
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
