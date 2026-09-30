import type { AiRunContext } from '../types'

const CHILD_DENIED_TOOLS = new Set([
  'delegate_to_subagent',
  'ask_user_question',
  'scheduled_task_list',
  'scheduled_task_action'
])
export const isToolAllowed = (ctx: Pick<AiRunContext, 'isSubagent'>, toolName: string): boolean =>
  !ctx.isSubagent || !CHILD_DENIED_TOOLS.has(toolName)
export const assertToolAllowed = (
  ctx: Pick<AiRunContext, 'isSubagent'>,
  toolName: string
): void => {
  if (!isToolAllowed(ctx, toolName))
    throw new SubagentBlockedError(`子任务不能使用 ${toolName}，请交回主伙伴`)
}
export class SubagentBlockedError extends Error {}
