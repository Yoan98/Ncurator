import { z } from 'zod/v4'

const id = z.string().trim().min(1).describe('skill_read 返回的稳定 skill ID')

export const SKILL_READ_SCHEMA = z.strictObject({
  id: id.optional().describe('skill ID；省略时列出共享 skill')
})

export const SKILL_EDIT_SCHEMA = z
  .strictObject({
    id: id.optional().describe('已有 skill ID；省略时创建'),
    sourcePath: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        '待发布完整目录的本机绝对路径；须含 SKILL.md（YAML 头含 name、description，随后为 Markdown 正文；name 为 1–64 位小写字母、数字或单连字符），可含 scripts、references、assets；编辑时先复制旧目录再修改草稿，更新完整替换，缺失文件视为移除；不接受应用托管目录'
      ),
    enabled: z.boolean().optional().describe('是否为当前伙伴启用；省略时创建不启用、更新保持原状')
  })
  .superRefine((input, context) => {
    if (
      (!input.id && !input.sourcePath) ||
      (input.id && !input.sourcePath && input.enabled === undefined)
    )
      context.addIssue({
        code: 'custom',
        message: '创建必须提供 sourcePath；更新必须提供 id 及 sourcePath 或 enabled'
      })
  })

export type SkillReadInput = z.infer<typeof SKILL_READ_SCHEMA>
export type SkillEditInput = z.infer<typeof SKILL_EDIT_SCHEMA>
