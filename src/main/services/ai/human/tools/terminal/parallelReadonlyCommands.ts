const TERMINAL_PARALLEL_READONLY_COMMAND_PATTERNS = [
  /^\s*cat\b/,
  /^\s*sed\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*rg\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*stat\b/,
  /^\s*wc\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*get-content\b/,
  /^\s*get-childitem\b/,
  /^\s*select-string\b/,
  /^\s*git\s+status\b/,
  /^\s*git\s+diff\b/,
  /^\s*git\s+show\b/
] as const

export const isParallelReadonlyTerminalCommand = (command: string): boolean => {
  const text = String(command || '').trim()
  return TERMINAL_PARALLEL_READONLY_COMMAND_PATTERNS.some((pattern) => pattern.test(text))
}

export const TERMINAL_PARALLEL_READONLY_COMMAND_GUIDANCE = [
  '`cat`',
  '`sed`',
  '`head`',
  '`tail`',
  '`rg`',
  '`grep`',
  '`find`',
  '`ls`',
  '`pwd`',
  '`stat`',
  '`wc`',
  '`echo`',
  '`printf`',
  '`Get-Content`',
  '`Get-ChildItem`',
  '`Select-String`',
  '`git status`',
  '`git diff`',
  '`git show`'
].join('、')
