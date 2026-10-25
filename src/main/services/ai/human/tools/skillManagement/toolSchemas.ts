import { z } from 'zod/v4'

export const SKILL_CONFIG_SCHEMA = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('list').describe('查询全部 Skill 启用状态') }),
  z.strictObject({
    action: z.literal('update').describe('批量修改 Skill 启用状态'),
    skills: z
      .array(
        z.strictObject({
          name: z
            .string()
            .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
            .max(64)
            .describe('Skill 名称'),
          enabled: z.boolean().describe('是否启用')
        })
      )
      .min(1)
      .max(1000)
      .superRefine((skills, ctx) => {
        const names = new Set<string>()
        skills.forEach(({ name }, index) => {
          if (names.has(name))
            ctx.addIssue({ code: 'custom', path: [index, 'name'], message: 'Duplicate Skill name' })
          names.add(name)
        })
      })
      .describe('要修改的 Skill；未列出的配置保持不变，整批提交或整批失败')
  })
])
