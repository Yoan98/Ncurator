import { z } from 'zod/v4'
import { PARTNER_MEMORY_CATEGORIES } from '../../../../../../shared/partnerMemory'
import type { HumanToolSpec } from '../types'
import { renderGenericModelError } from '../../shared/modelToolResultRenderers'

const category = z
  .enum(PARTNER_MEMORY_CATEGORIES)
  .describe('cooperation_preferences：合作偏好；project_background：项目背景')

export const MEMORY_SCHEMA = z.discriminatedUnion('action', [
  z
    .object({
      category,
      action: z.literal('append').describe('换行追加'),
      content: z.string().min(1).describe('追加的内容')
    })
    .strict(),
  z
    .object({
      category,
      action: z.literal('edit').describe('批量精确替换'),
      edits: z
        .array(
          z
            .object({
              oldText: z.string().min(1).describe('被替换的原文片段，必须唯一匹配'),
              newText: z.string().describe('替换后的文字，空字符串表示删除')
            })
            .strict()
        )
        .min(1)
        .describe('替换项列表，各项必须唯一匹配且互不重叠')
    })
    .strict()
])

export const MEMORY_TOOL_SPEC: HumanToolSpec<z.infer<typeof MEMORY_SCHEMA>, 'memory', 'memory'> = {
  name: 'memory',
  familyId: 'memory',
  toolsetIds: ['memory'],
  inputSchema: MEMORY_SCHEMA,
  promptSpec: { name: 'memory', description: '新增或修改当前伙伴的长期记忆，待用户确认后生效。' },
  resolveExecutionMeta: (args) => ({
    mutability: 'mutating',
    resourceKey: `memory:${args.category}`
  }),
  modelResult: {
    renderSuccess: () => '修改已提交，待用户确认。',
    renderError: renderGenericModelError
  }
}
