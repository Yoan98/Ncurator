import type { TerminalCommandSegment } from '../types'
import type { DangerousCommandRule } from './types'

const commandName = (segment: TerminalCommandSegment): string =>
  String(segment.tokens[0] || '').toLowerCase()

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
  const interpreter =
    command === 'python' ||
    command === 'python3' ||
    command === 'python.exe' ||
    command === 'python3.exe' ||
    command === 'node' ||
    command === 'node.exe' ||
    command === 'perl' ||
    command === 'ruby' ||
    command === 'php' ||
    command === 'pwsh' ||
    command === 'pwsh.exe' ||
    command === 'powershell' ||
    command === 'powershell.exe' ||
    command === 'cmd' ||
    command === 'cmd.exe' ||
    command === 'sh' ||
    command === 'bash' ||
    command === 'zsh' ||
    command === 'dash' ||
    command === 'fish'
  if (!interpreter) return false

  const options = segment.tokens.slice(1).map((token) => token.toLowerCase())
  if (command.startsWith('powershell') || command.startsWith('pwsh')) {
    return options.some((token) =>
      ['-command', '-c', '-encodedcommand', '-ec', '-encodedarguments', '-ea'].includes(token)
    )
  }
  if (command === 'cmd' || command === 'cmd.exe') {
    return options.some((token) => ['/c', '/k'].includes(token))
  }
  return options.some((token) => ['-c', '-e', '--eval', '--execute'].includes(token))
}

const isNestedShellLauncher = (segment: TerminalCommandSegment): boolean => {
  const command = commandName(segment)
  if (isInlineInterpreter(segment)) return true
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
    return segment.tokens.slice(1).some((token) => shellNames.includes(token.toLowerCase()))
  }
  return false
}

const isPowerShellDynamicEvaluator = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, ['invoke-expression', 'iex', 'invoke-command', 'icm'])

const isProcessOrPrivilegeCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, [
    'sudo',
    'runas',
    'start-process',
    'start',
    'stop-process',
    'taskkill',
    'kill',
    'pkill',
    'sc',
    'sc.exe',
    'reg',
    'reg.exe',
    'schtasks',
    'schtasks.exe'
  ])

const isDestructiveCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, [
    'remove-item',
    'del',
    'delete',
    'erase',
    'rd',
    'rmdir',
    'rm',
    'rmdir',
    'truncate',
    'clear-content',
    'set-content',
    'add-content',
    'out-file',
    'move-item',
    'mv',
    'git-clean',
    'git-reset',
    'git-restore',
    'git-checkout'
  ]) ||
  (commandName(segment) === 'git' &&
    hasOptionPrefix(segment, ['reset', 'clean', 'restore', 'checkout']) &&
    hasToken(segment, ['--hard', '-d', '-f']))

const isFileWriteCommand = (segment: TerminalCommandSegment): boolean =>
  isAnyCommand(segment, [
    'new-item',
    'mkdir',
    'md',
    'ni',
    'copy-item',
    'copy',
    'cp',
    'touch',
    'install',
    'tee'
  ])

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
  }
]

export const getDangerousCommandGuidance = (): string =>
  buildDangerousCommandRules()
    .map((rule) => `\`${rule.id}\``)
    .join(', ')
