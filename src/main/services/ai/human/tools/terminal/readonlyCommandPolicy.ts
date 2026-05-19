import { parseShellCommandSegments } from './commandParsing'
import type { TerminalReadonlyPolicyResult } from './types'
import { getAiRuntimePlatform } from '../../../utils/platform'

type ReadonlyCommandRule = {
  id: string
  guidance: string
  matches: (segment: { text: string; tokens: string[] }) => boolean
}

const hasShellMetacharacters = (segmentText: string): boolean =>
  /(^|[^\\])(?:>>?|<|\(|\)|\$\(.*|\*)/.test(segmentText) || /\btee\b/i.test(segmentText)

const hasForbiddenToken = (tokens: readonly string[], forbidden: readonly string[]): boolean => {
  const normalized = tokens.map((token) => token.toLowerCase())
  return forbidden.some((token) => normalized.includes(token))
}

const isSimpleCommand = (
  tokens: readonly string[],
  commandNames: readonly string[],
  forbidden: readonly string[] = []
): boolean => {
  if (tokens.length === 0) return false
  const [head] = tokens
  if (!head || !commandNames.includes(head.toLowerCase())) return false
  return !hasForbiddenToken(tokens.slice(1), forbidden)
}

const isGitReadonlyCommand = (tokens: readonly string[], subcommand: 'status' | 'diff' | 'show'): boolean => {
  if (tokens.length < 2) return false
  if (tokens[0].toLowerCase() !== 'git') return false
  if (tokens[1].toLowerCase() !== subcommand) return false
  return !hasForbiddenToken(tokens.slice(2), ['>', '>>'])
}

const READONLY_COMMAND_RULES: ReadonlyCommandRule[] = [
  { id: 'pwd', guidance: '`pwd`', matches: ({ tokens }) => isSimpleCommand(tokens, ['pwd']) },
  { id: 'ls', guidance: '`ls`', matches: ({ tokens }) => isSimpleCommand(tokens, ['ls']) },
  { id: 'cat', guidance: '`cat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['cat']) },
  { id: 'head', guidance: '`head`', matches: ({ tokens }) => isSimpleCommand(tokens, ['head']) },
  { id: 'tail', guidance: '`tail`', matches: ({ tokens }) => isSimpleCommand(tokens, ['tail']) },
  { id: 'wc', guidance: '`wc`', matches: ({ tokens }) => isSimpleCommand(tokens, ['wc']) },
  { id: 'stat', guidance: '`stat`', matches: ({ tokens }) => isSimpleCommand(tokens, ['stat']) },
  { id: 'echo', guidance: '`echo`', matches: ({ tokens }) => isSimpleCommand(tokens, ['echo']) },
  { id: 'printf', guidance: '`printf`', matches: ({ tokens }) => isSimpleCommand(tokens, ['printf']) },
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
  }
]

export const TERMINAL_READONLY_COMMAND_GUIDANCE = READONLY_COMMAND_RULES.map(
  (rule) => rule.guidance
).join('、')

export const analyzeReadonlyTerminalCommandPolicy = (command: string): TerminalReadonlyPolicyResult => {
  const text = String(command || '').trim()
  if (!text) {
    return {
      executionPolicy: 'approval_required',
      mutability: 'mutating',
      parallelSafe: false,
      reason: 'empty command is not allowed'
    }
  }

  const windowsStyle = getAiRuntimePlatform() === 'windows'
  const segments = parseShellCommandSegments(text, { windowsStyle })
  if (segments.length !== 1) {
    return {
      executionPolicy: 'approval_required',
      mutability: 'mutating',
      parallelSafe: false,
      reason: 'only one simple terminal command can run without approval'
    }
  }

  const [segment] = segments
  if (!segment || hasShellMetacharacters(segment.text)) {
    return {
      executionPolicy: 'approval_required',
      mutability: 'mutating',
      parallelSafe: false,
      reason: 'command uses shell features outside the approved readonly command set'
    }
  }

  const matchedRule = READONLY_COMMAND_RULES.find((rule) => rule.matches(segment))
  if (!matchedRule) {
    return {
      executionPolicy: 'approval_required',
      mutability: 'mutating',
      parallelSafe: false,
      reason: 'command is outside the approved readonly terminal command set'
    }
  }

  return {
    executionPolicy: 'readonly_allowed',
    mutability: 'read_only',
    parallelSafe: true,
    matchedRuleId: matchedRule.id,
    reason: `matched readonly rule ${matchedRule.id}`
  }
}
