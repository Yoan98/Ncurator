import type { ReadonlyCommandRule } from './types'

const isSimpleCommand = (tokens: readonly string[], commandNames: readonly string[]): boolean => {
  const [head] = tokens
  return Boolean(head && commandNames.includes(head.toLowerCase()))
}

const isGitReadonlyCommand = (
  tokens: readonly string[],
  subcommand: 'status' | 'diff' | 'show' | 'log'
): boolean =>
  tokens.length >= 2 &&
  tokens[0]?.toLowerCase() === 'git' &&
  tokens[1]?.toLowerCase() === subcommand

const STATIC_PROPERTY_NAME = /^[\p{L}_*][\p{L}\p{N}_.*-]*$/u

const isStaticPropertyName = (token: string): boolean => {
  const name = token.endsWith(',') ? token.slice(0, -1) : token
  return Boolean(name && STATIC_PROPERTY_NAME.test(name))
}

const isReadonlySelectObject = (tokens: readonly string[]): boolean => {
  if (tokens[0]?.toLowerCase() !== 'select-object' || tokens.length < 2) return false

  let expectsProperty = false
  for (const token of tokens.slice(1)) {
    const normalized = token.toLowerCase()
    if (normalized === '-property' || normalized === '-expandproperty') {
      expectsProperty = true
      continue
    }
    if (token.startsWith('-')) return false
    if (!isStaticPropertyName(token)) return false
    expectsProperty = false
  }
  return !expectsProperty
}

export const WINDOWS_READONLY_COMMAND_RULES: ReadonlyCommandRule[] = [
  {
    id: 'get-location',
    guidance: '`Get-Location`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-location'])
  },
  {
    id: 'get-childitem',
    guidance: '`Get-ChildItem`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-childitem'])
  },
  {
    id: 'get-content',
    guidance: '`Get-Content`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['get-content'])
  },
  {
    id: 'select-string',
    guidance: '`Select-String`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['select-string'])
  },
  {
    id: 'select-object',
    guidance: '`Select-Object`',
    matches: ({ tokens }) => isReadonlySelectObject(tokens)
  },
  {
    id: 'test-path',
    guidance: '`Test-Path`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['test-path'])
  },
  {
    id: 'resolve-path',
    guidance: '`Resolve-Path`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['resolve-path'])
  },
  {
    id: 'write-output',
    guidance: '`Write-Output`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['write-output'])
  },
  {
    id: 'git-status',
    guidance: '`git status`',
    matches: ({ tokens }) => isGitReadonlyCommand(tokens, 'status')
  },
  {
    id: 'git-diff',
    guidance: '`git diff`',
    matches: ({ tokens }) => isGitReadonlyCommand(tokens, 'diff')
  },
  {
    id: 'git-show',
    guidance: '`git show`',
    matches: ({ tokens }) => isGitReadonlyCommand(tokens, 'show')
  },
  {
    id: 'git-log',
    guidance: '`git log`',
    matches: ({ tokens }) => isGitReadonlyCommand(tokens, 'log')
  }
]

export const WINDOWS_MUTATING_COMMANDS = new Set([
  'add-content',
  'clear-content',
  'copy-item',
  'move-item',
  'new-item',
  'out-file',
  'remove-item',
  'rename-item',
  'set-content',
  'set-item',
  'set-itemproperty',
  'start-process',
  'stop-process'
])
