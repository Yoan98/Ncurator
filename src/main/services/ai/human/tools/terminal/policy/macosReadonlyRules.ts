import type { ReadonlyCommandRule } from './types'

const hasForbiddenToken = (tokens: readonly string[], forbidden: readonly string[]): boolean => {
  const normalized = tokens.map((token) => token.toLowerCase())
  return forbidden.some((token) => normalized.includes(token))
}

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

const isReadonlyFindCommand = (tokens: readonly string[]): boolean =>
  tokens[0]?.toLowerCase() === 'find' &&
  !hasForbiddenToken(tokens.slice(1), [
    '-delete',
    '-exec',
    '-execdir',
    '-fprint',
    '-fprint0',
    '-fprintf',
    '-fls',
    '-ok',
    '-okdir'
  ])

export const MACOS_READONLY_COMMAND_RULES: ReadonlyCommandRule[] = [
  { id: 'pwd', guidance: '`pwd`', matches: ({ tokens }) => isSimpleCommand(tokens, ['pwd']) },
  { id: 'ls', guidance: '`ls`', matches: ({ tokens }) => isSimpleCommand(tokens, ['ls']) },
  { id: 'cat', guidance: '`cat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['cat']) },
  {
    id: 'strings',
    guidance: '`strings`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['strings'])
  },
  { id: 'head', guidance: '`head`', matches: ({ tokens }) => isSimpleCommand(tokens, ['head']) },
  { id: 'tail', guidance: '`tail`', matches: ({ tokens }) => isSimpleCommand(tokens, ['tail']) },
  { id: 'wc', guidance: '`wc`', matches: ({ tokens }) => isSimpleCommand(tokens, ['wc']) },
  { id: 'stat', guidance: '`stat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['stat']) },
  { id: 'echo', guidance: '`echo`', matches: ({ tokens }) => isSimpleCommand(tokens, ['echo']) },
  {
    id: 'printf',
    guidance: '`printf`',
    matches: ({ tokens }) => isSimpleCommand(tokens, ['printf'])
  },
  { id: 'find', guidance: '`find`', matches: ({ tokens }) => isReadonlyFindCommand(tokens) },
  { id: 'rg', guidance: '`rg`', matches: ({ tokens }) => isSimpleCommand(tokens, ['rg']) },
  { id: 'grep', guidance: '`grep`', matches: ({ tokens }) => isSimpleCommand(tokens, ['grep']) },
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

export const MACOS_MUTATING_COMMANDS = new Set([
  'chmod',
  'chown',
  'cp',
  'mkdir',
  'mv',
  'rm',
  'rmdir',
  'tee',
  'touch'
])
