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
    description: '能力：等待指定秒数。\n结果：返回实际等待毫秒数。\n边界：不读取或修改内容。',
    whenToUse: '适用于任务需要等待页面或异步状态变化的情况。',
    examples: [
      {
        goal: '等待页面加载完成',
        args: {
          seconds: 2
        }
      }
    ]
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
      '能力：暂停当前任务，等待用户在右侧内置浏览器完成登录、授权、安全验证、支付确认等必须由本人操作的步骤。\n参数：message 是最多 30 个字符的简短中文提示，用于说明用户需要完成的操作。\n结果：用户确认后恢复任务。\n边界：不索要、填写或记录密码、验证码及其他敏感信息。',
    whenToUse: '适用于 browser_use 遇到必须由用户亲自完成的网页步骤。',
    examples: [
      {
        goal: '网页要求用户登录后才能继续',
        args: {
          message: '请在右侧浏览器完成登录'
        }
      }
    ]
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'user-takeover'
  })
}

export const UTILITY_TOOL_SPECS = [WAIT_TIME_TOOL_SPEC, WAIT_FOR_USER_TAKEOVER_TOOL_SPEC] as const
