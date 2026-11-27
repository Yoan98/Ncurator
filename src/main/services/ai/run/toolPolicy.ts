import type { AiRunContext } from '../types'

const CHILD_DENIED_TOOLS = new Set([
  'delegate_to_subagent',
  'drawing',
  'list_agent',
  'ask_user_question',
  'scheduled_task_list',
  'scheduled_task_action',
  'skill_config',
  'memory'
])
type AgentToolContext = Pick<AiRunContext, 'isSubagent' | 'agentProfile'>
// 绘画任务已持有渲染队列，嵌套剪辑会等待自身释放。
export const isToolAllowed = (ctx: AgentToolContext, toolName: string): boolean =>
  !(ctx.agentProfile === 'drawing' && toolName.startsWith('video_')) &&
  (!ctx.isSubagent || !CHILD_DENIED_TOOLS.has(toolName))
export const assertToolAllowed = (ctx: AgentToolContext, toolName: string): void => {
  if (!isToolAllowed(ctx, toolName))
    throw new SubagentBlockedError(`子任务不能使用 ${toolName}，请交回主伙伴`)
}
export class SubagentBlockedError extends Error {}
