import { z } from 'zod/v4'

export const SKILL_SYNC_SCHEMA = z
  .strictObject({
    action: z
      .enum(['status', 'sync'])
      .describe('status 只读查询当前伙伴的启用状态；sync 校验目录并同步索引及可选启用配置'),
    name: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(64)
      .optional()
      .describe('与 Skill 目录同名；sync 必填，status 省略时查询全部已登记 Skill'),
    enabled: z
      .boolean()
      .optional()
      .describe('仅 sync 可用：是否为当前伙伴启用；省略时新建关闭、已有配置保持不变')
  })
  .superRefine((input, ctx) => {
    if (input.action === 'sync' && !input.name)
      ctx.addIssue({ code: 'custom', message: 'sync requires name' })
    if (input.action === 'status' && input.enabled !== undefined)
      ctx.addIssue({ code: 'custom', message: 'status cannot change enabled' })
  })

export type SkillSyncInput = z.infer<typeof SKILL_SYNC_SCHEMA>
