import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WAIT_TIME_SCHEMA = z.object({
  seconds: z.number().min(0).max(60)
})

export const WAIT_TIME_OUTPUT_SCHEMA = z.object({
  waitedMs: z.number().int()
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

export const UTILITY_TOOL_SPECS = [WAIT_TIME_TOOL_SPEC] as const
