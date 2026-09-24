import type { AiRuntimePlatform } from '../../types'

export type TerminalReviewPromptCommand = {
  commandId: string
  command: string
  commandExplanation: string
}

export const TERMINAL_REVIEW_SYSTEM_PROMPT = `你是终端命令审核员。根据已知信息，判断操作是否为完成用户诉求所需且合理的命令。
如果该命令没问题，返回 auto_approve；无法确认或认为有问题时，返回 needs_human_review。
decision 只允许 auto_approve 或 needs_human_review。每条命令必须恰好返回一项，不得遗漏、重复或增加。
只返回合法 JSON，格式为：
{"decisions":[{"commandId":"cmd-1","decision":"auto_approve"}]}
`

const renderCommand = (item: TerminalReviewPromptCommand, index: number): string =>
  [
    `${index + 1}. 命令 ID：${item.commandId}`,
    `用途说明：${item.commandExplanation}`,
    `命令：${item.command}`
  ].join('\n')

export const buildTerminalReviewPrompt = (input: {
  userRequest: string
  platform: AiRuntimePlatform
  workingDirectory: string
  commands: readonly TerminalReviewPromptCommand[]
  retryHint?: boolean
}): { system: string; user: string } => ({
  system: TERMINAL_REVIEW_SYSTEM_PROMPT,
  user: [
    '用户原话：',
    input.userRequest,
    '',
    `平台：${input.platform === 'windows' ? 'Windows' : 'macOS'}`,
    `执行目录：${input.workingDirectory}`,
    '',
    `待审核命令（${input.commands.length} 条）：`,
    ...input.commands.map(renderCommand),
    ...(input.retryHint
      ? [
          '',
          '上一次响应未通过 JSON 或命令 ID 完整性校验。请严格按 System 中的格式重新返回完整结果。'
        ]
      : [])
  ].join('\n')
})
