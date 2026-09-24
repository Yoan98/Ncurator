import type { TerminalCommandSegment } from '../types'
import type { DangerousCommandRule } from './types'

const DESTRUCTIVE_COMMAND_NAMES = [
  'remove-item',
  'ri',
  'del',
  'delete',
  'erase',
  'rd',
  'rmdir',
  'rm',
  'truncate',
  'clear-content',
  'set-content',
  'add-content',
  'out-file',
  'move-item',
  'mi',
  'mv',
  'chmod',
  'chown',
  'chgrp',
  'dd',
  'shred',
  'diskutil',
  'mkfs',
  'format'
] as const

const FILE_WRITE_COMMAND_NAMES = [
  'new-item',
  'ni',
  'mkdir',
  'md',
  'copy-item',
  'cpi',
  'copy',
  'cp',
  'touch',
  'install',
  'export-csv',
  'rename-item',
  'tee'
] as const

const PROCESS_OR_PRIVILEGE_COMMAND_NAMES = [
  'sudo',
  'runas',
  'start-process',
  'start',
  'stop-process',
  'start-service',
  'stop-service',
  'restart-service',
  'set-service',
  'register-scheduledtask',
  'unregister-scheduledtask',
  'taskkill',
  'kill',
  'pkill',
  'sc',
  'sc.exe',
  'reg',
  'reg.exe',
  'schtasks',
  'schtasks.exe'
] as const

const INLINE_INTERPRETER_NAMES = [
  'python',
  'python3',
  'python.exe',
  'python3.exe',
  'node',
  'node.exe',
  'perl',
  'ruby',
  'php',
  'pwsh',
  'pwsh.exe',
  'powershell',
  'powershell.exe',
  'cmd',
  'cmd.exe',
  'sh',
  'bash',
  'zsh',
  'dash',
  'fish'
] as const

export const isDangerousCommandName = (name: string): boolean =>
  (DESTRUCTIVE_COMMAND_NAMES as readonly string[]).includes(name) ||
  (FILE_WRITE_COMMAND_NAMES as readonly string[]).includes(name) ||
  (PROCESS_OR_PRIVILEGE_COMMAND_NAMES as readonly string[]).includes(name) ||
  (INLINE_INTERPRETER_NAMES as readonly string[]).includes(name)

export const normalizeCommandName = (value: string): string => {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .toLowerCase()
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

const commandName = (segment: TerminalCommandSegment): string =>
  normalizeCommandName(segment.tokens[0] || '')

const hasToken = (segment: TerminalCommandSegment, values: readonly string[]): boolean => {
  const normalized = segment.tokens.map((token) => token.toLowerCase())
  return values.some((value) => normalized.includes(value))
}

const hasOptionPrefix = (segment: TerminalCommandSegment, values: readonly string[]): boolean =>
  segment.tokens.some((token) => {
    const normalized = token.toLowerCase()
    return values.some((value) => normalized === value || normalized.startsWith(`${value}=`))
  })

const isAnyCommand = (segment: TerminalCommandSegment, names: readonly string[]): boolean =>
  names.includes(commandName(segment))

const isInlineInterpreter = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  const interpreter = (INLINE_INTERPRETER_NAMES as readonly string[]).includes(command)
  if (!interpreter) return false

  const options = segment.tokens.slice(1).map((token) => token.toLowerCase())
  if (command.startsWith('powershell') || command.startsWith('pwsh')) {
    return options.some(
      (token) =>
        token === '-c' ||
        token.startsWith('-com') ||
        token.startsWith('-enc') ||
        token.startsWith('-ea')
    )
  }
  if (command === 'cmd' || command === 'cmd.exe') {
    return options.some((token) => token.startsWith('/c') || token.startsWith('/k'))
  }
  return options.some(
    (token) =>
      token === '-c' ||
      token === '-e' ||
      token.startsWith('-c=') ||
      token.startsWith('-e=') ||
      token.startsWith('--eval') ||
      token.startsWith('--execute')
  )
}

const isScriptOrProgramExecution = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  const rawCommand = segment.tokens[0] || ''
  if (
    /^(?:\.\.?[\\/]).+/.test(rawCommand) ||
    /\.(?:ps1|sh|bash|zsh|py|js|mjs|cjs|bat|cmd|exe)$/i.test(rawCommand)
  ) {
    return true
  }
  if (/^(?:python(?:\d+(?:\.\d+)?)?(?:\.exe)?|node(?:\.exe)?|perl|ruby|php)$/.test(command)) {
    const args = segment.tokens.slice(1)
    if (/<<-?\s*['"]?[A-Za-z_][\w]*/.test(segment.text)) return true
    return !args.some((arg) => ['-h', '--help', '-v', '-V', '--version'].includes(arg))
  }
  return false
}

const isPackageOrBuildExecution = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  const args = segment.tokens.slice(1).map((arg) => arg.toLowerCase())
  const action = args.find((arg) => !arg.startsWith('-'))
  if (['npx', 'bunx', 'uvx'].includes(command)) {
    return !args.some((arg) => ['-h', '--help', '-v', '--version'].includes(arg))
  }
  if (['npm', 'pnpm', 'yarn', 'bun'].includes(command)) {
    return Boolean(
      action &&
      [
        'install',
        'i',
        'ci',
        'add',
        'remove',
        'uninstall',
        'run',
        'exec',
        'dlx',
        'x',
        'build',
        'test',
        'start',
        'create'
      ].includes(action)
    )
  }
  if (
    ['pip', 'pip3', 'uv', 'poetry', 'conda', 'brew', 'winget', 'choco', 'scoop'].includes(command)
  ) {
    return Boolean(
      action &&
      [
        'install',
        'add',
        'remove',
        'uninstall',
        'update',
        'upgrade',
        'run',
        'exec',
        'sync',
        'build'
      ].includes(action)
    )
  }
  if (['make', 'cmake', 'ninja', 'msbuild', 'gradle', 'mvn'].includes(command)) {
    return !args.some((arg) => ['--help', '-h', '--version', '-v'].includes(arg))
  }
  if (['cargo', 'dotnet', 'go', 'swift'].includes(command)) {
    return Boolean(action && ['build', 'run', 'test', 'install', 'publish'].includes(action))
  }
  return false
}

const isArchiveSyncOrDownloadWrite = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  const args = segment.tokens.slice(1).map((arg) => arg.toLowerCase())
  if (
    ['rsync', 'robocopy', 'xcopy', 'expand-archive', 'compress-archive', '7z', '7za'].includes(
      command
    )
  )
    return true
  if (command === 'unzip') return !args.some((arg) => ['-l', '-v', '-t', '-z'].includes(arg))
  if (command === 'tar') {
    const action = args[0] || ''
    return (
      /^[xc][a-z]*$/.test(action) ||
      /^-[a-z]*[xc][a-z]*$/.test(action) ||
      args.some((arg) => ['--extract', '--create'].includes(arg))
    )
  }
  if (command === 'curl')
    return segment.tokens
      .slice(1)
      .some(
        (arg) =>
          ['-o', '--output', '-O', '--remote-name', '-T', '--upload-file'].includes(arg) ||
          arg.toLowerCase().startsWith('--output=') ||
          /^-[^-]*[oO]/.test(arg)
      )
  if (command === 'wget') {
    const rawArgs = segment.tokens.slice(1)
    return (
      !rawArgs.includes('--spider') &&
      !rawArgs.includes('-O-') &&
      !(rawArgs.includes('-O') && rawArgs.includes('-')) &&
      !rawArgs.some((arg) => /^-[^-]*O-$/.test(arg))
    )
  }
  if (command === 'invoke-webrequest' || command === 'iwr')
    return args.some((arg) => ['-outfile', '-of'].includes(arg))
  return false
}

const isGitWrite = (segment: TerminalCommandSegment): boolean => {
  if (commandName(segment) !== 'git') return false
  const args = segment.tokens.slice(1).map((arg) => arg.toLowerCase())
  let actionIndex = 0
  while (actionIndex < args.length) {
    const arg = args[actionIndex]
    if (['-c', '--git-dir', '--work-tree'].includes(arg)) {
      actionIndex += 2
    } else if (arg.startsWith('-')) {
      actionIndex += 1
    } else {
      break
    }
  }
  const action = args[actionIndex]
  const actionArgs = args.slice(actionIndex)
  if ((action === 'branch' || action === 'tag') && actionArgs.length === 1) return false
  if (
    action === 'branch' &&
    actionArgs.some((arg) => ['--list', '-l', '--show-current', '-a', '-r'].includes(arg))
  )
    return false
  if (action === 'tag' && actionArgs.some((arg) => ['--list', '-l'].includes(arg))) return false
  if (action === 'worktree' && actionArgs.includes('list')) return false
  if (action === 'config') {
    if (
      actionArgs.some((arg) => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(arg))
    )
      return false
    if (
      actionArgs.some((arg) =>
        [
          '--add',
          '--replace-all',
          '--unset',
          '--unset-all',
          '--edit',
          '--remove-section',
          '--rename-section'
        ].includes(arg)
      )
    )
      return true
    const positionals: string[] = []
    for (let index = 1; index < actionArgs.length; index += 1) {
      const arg = actionArgs[index]
      if (['--file', '-f', '--blob'].includes(arg)) {
        index += 1
      } else if (!arg.startsWith('-')) {
        positionals.push(arg)
      }
    }
    return positionals.length >= 2
  }
  if (action === 'remote')
    return actionArgs.some((arg) => ['add', 'remove', 'rename', 'set-url'].includes(arg))
  if (action === 'submodule') return !actionArgs.some((arg) => ['status', 'summary'].includes(arg))
  return Boolean(
    action &&
    [
      'add',
      'am',
      'apply',
      'branch',
      'checkout',
      'cherry-pick',
      'clean',
      'clone',
      'commit',
      'fetch',
      'merge',
      'pull',
      'push',
      'rebase',
      'reset',
      'restore',
      'revert',
      'rm',
      'stash',
      'switch',
      'tag',
      'worktree'
    ].includes(action)
  )
}

const isNetworkWrite = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  const rawArgs = segment.tokens.slice(1)
  const args = rawArgs.map((arg) => arg.toLowerCase())
  if (command === 'curl') {
    return rawArgs.some(
      (arg, index) =>
        [
          '-d',
          '-F',
          '--data',
          '--data-raw',
          '--data-binary',
          '--data-urlencode',
          '--form',
          '--json'
        ].includes(arg) ||
        [
          '--data=',
          '--data-raw=',
          '--data-binary=',
          '--data-urlencode=',
          '--form=',
          '--json=',
          '--request='
        ].some(
          (prefix) =>
            arg.startsWith(prefix) &&
            (prefix !== '--request=' ||
              /^(?:post|put|patch|delete)$/i.test(arg.slice(prefix.length)))
        ) ||
        /^-X(?:POST|PUT|PATCH|DELETE)$/i.test(arg) ||
        (['-X', '--request'].includes(arg) &&
          ['post', 'put', 'patch', 'delete'].includes(args[index + 1] || ''))
    )
  }
  if (['invoke-restmethod', 'irm', 'invoke-webrequest', 'iwr'].includes(command)) {
    return args.some(
      (arg, index) =>
        ['-method', '-m'].includes(arg) &&
        ['post', 'put', 'patch', 'delete'].includes(args[index + 1] || '')
    )
  }
  return false
}

const isNestedShellLauncher = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  if (isInlineInterpreter(segment)) return true
  if (
    [
      'cmd',
      'cmd.exe',
      'powershell',
      'powershell.exe',
      'pwsh',
      'pwsh.exe',
      'sh',
      'bash',
      'zsh',
      'dash',
      'fish'
    ].includes(command)
  ) {
    return true
  }
  if (command === 'xargs') return true
  if (command === 'start-process' || command === 'start') {
    const shellNames = [
      'cmd',
      'cmd.exe',
      'powershell',
      'powershell.exe',
      'pwsh',
      'pwsh.exe',
      'sh',
      'bash',
      'zsh'
    ]
    return segment.tokens.slice(1).some((token) => shellNames.includes(normalizeCommandName(token)))
  }
  return false
}

const isPowerShellDynamicEvaluator = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, ['invoke-expression', 'iex', 'invoke-command', 'icm'])

const isProcessOrPrivilegeCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, PROCESS_OR_PRIVILEGE_COMMAND_NAMES)

const isDestructiveCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, DESTRUCTIVE_COMMAND_NAMES) ||
  (commandName(segment) === 'git' &&
    (() => {
      const subcommand = segment.tokens[1]?.toLowerCase()
      if (subcommand === 'reset' || subcommand === 'clean' || subcommand === 'restore') return true
      return subcommand === 'checkout' && segment.tokens.includes('--')
    })())

const isFileWriteCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, FILE_WRITE_COMMAND_NAMES)

const isDangerousArgument = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  if (command === 'find') {
    return hasToken(segment, [
      '-delete',
      '-exec',
      '-execdir',
      '-ok',
      '-okdir',
      '-fprint',
      '-fprint0',
      '-fprintf',
      '-fls'
    ])
  }
  if (command === 'sed') return hasOptionPrefix(segment, ['-i', '--in-place'])
  if (command === 'perl') return hasOptionPrefix(segment, ['-i', '-pi', '-n', '-p'])
  if (command === 'git') {
    return (
      hasOptionPrefix(segment, ['--force', '-f']) &&
      hasToken(segment, ['push', 'reset', 'clean', 'checkout', 'restore'])
    )
  }
  return false
}

export const buildDangerousCommandRules = (): readonly DangerousCommandRule[] => [
  {
    id: 'inline-interpreter',
    reasonCode: 'inline_code_execution',
    description: 'inline interpreter code execution',
    matches: isInlineInterpreter
  },
  {
    id: 'nested-shell-launcher',
    reasonCode: 'nested_shell_execution',
    description: 'nested shell or command launcher execution',
    matches: isNestedShellLauncher
  },
  {
    id: 'powershell-dynamic-evaluator',
    reasonCode: 'inline_code_execution',
    description: 'PowerShell dynamic code evaluation',
    matches: isPowerShellDynamicEvaluator
  },
  {
    id: 'destructive-command',
    reasonCode: 'destructive_command',
    description: 'destructive or overwriting command',
    matches: isDestructiveCommand
  },
  {
    id: 'file-write-command',
    reasonCode: 'file_write',
    description: 'file creation or update command',
    matches: isFileWriteCommand
  },
  {
    id: 'dangerous-argument',
    reasonCode: 'dangerous_argument',
    description: 'dangerous command argument',
    matches: isDangerousArgument
  },
  {
    id: 'process-or-privilege-control',
    reasonCode: 'privilege_or_process_control',
    description: 'privilege escalation or process/system control',
    matches: isProcessOrPrivilegeCommand
  },
  {
    id: 'script-or-program-execution',
    reasonCode: 'inline_code_execution',
    description: 'explicit script or program execution',
    matches: isScriptOrProgramExecution
  },
  {
    id: 'package-or-build-execution',
    reasonCode: 'inline_code_execution',
    description: 'package manager or build execution',
    matches: isPackageOrBuildExecution
  },
  {
    id: 'archive-sync-download-write',
    reasonCode: 'file_write',
    description: 'archive, sync or download writes local files',
    matches: isArchiveSyncOrDownloadWrite
  },
  {
    id: 'git-write',
    reasonCode: 'file_write',
    description: 'git writes repository or remote state',
    matches: isGitWrite
  },
  {
    id: 'network-write',
    reasonCode: 'dangerous_argument',
    description: 'network request can modify remote state',
    matches: isNetworkWrite
  }
]
