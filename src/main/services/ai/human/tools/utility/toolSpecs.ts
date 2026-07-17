import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WAIT_TIME_SCHEMA = z.object({
  seconds: z.number().min(0).max(60)
})

export const WAIT_TIME_OUTPUT_SCHEMA = z.object({
  waitedMs: z.number().int()
})

export const WAIT_FOR_USER_TAKEOVER_SCHEMA = z.object({
  message: z.string().trim().min(1).max(30)
})

export const WAIT_FOR_USER_TAKEOVER_OUTPUT_SCHEMA = z.object({
  confirmed: z.literal(true),
  message: z.string()
})

export const WAIT_TIME_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WAIT_TIME_SCHEMA>,
  z.infer<typeof WAIT_TIME_OUTPUT_SCHEMA>,
  'wait_time',
  'utility'
> = {
  name: 'wait_time',
  familyId: 'utility',
  skillIds: ['utility'],
  requiresWorkspace: false,
  inputSchema: WAIT_TIME_SCHEMA,
  outputSchema: WAIT_TIME_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'wait_time',
    description: '等待指定秒数，并返回实际等待毫秒数。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'timer'
  })
}

export const WAIT_FOR_USER_TAKEOVER_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WAIT_FOR_USER_TAKEOVER_SCHEMA>,
  z.infer<typeof WAIT_FOR_USER_TAKEOVER_OUTPUT_SCHEMA>,
  'wait_for_user_takeover',
  'utility'
> = {
  name: 'wait_for_user_takeover',
  familyId: 'utility',
  skillIds: ['utility'],
  requiresWorkspace: false,
  inputSchema: WAIT_FOR_USER_TAKEOVER_SCHEMA,
  outputSchema: WAIT_FOR_USER_TAKEOVER_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'wait_for_user_takeover',
    description:
      '暂停任务并等待用户在内置浏览器完成需本人操作的步骤，并在用户确认后恢复任务。你需要传递给用户的提示信息，不能超过 30 个字符。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'user-takeover'
  })
}

export const UTILITY_TOOL_SPECS = [WAIT_TIME_TOOL_SPEC, WAIT_FOR_USER_TAKEOVER_TOOL_SPEC] as const
