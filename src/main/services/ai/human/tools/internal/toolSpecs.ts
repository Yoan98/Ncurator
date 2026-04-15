import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import { historySearchFilterSchema } from '../../schema'

const HISTORY_SEARCH_EXAMPLE: JsonObject = {
  query: 'docx_text_edit',
  limit: 2
}

const HISTORY_LIST_EXAMPLE: JsonObject = {
  endRoundId: 10,
  limit: 5
}

const INTERNAL_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  parallelSafe: true,
  defaultResourceKey: 'human-round-history'
})

export const HISTORY_SEARCH_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof historySearchFilterSchema> & { query: string },
  'history_search',
  'history-recall'
> = {
  name: 'history_search',
  familyId: 'internal',
  skillIds: ['history-recall'],
  requiresWorkspace: false,
  schema: historySearchFilterSchema.extend({
    query: z.string().min(1)
  }),
  promptSpec: {
    name: 'history_search',
    purpose: '按关键词搜索你自己的过程历史。',
    whenToUse: '当你记得某个关键词、工具名或事实片段，想在更早轮次里重新找到它时使用。',
    preconditions: ['它只读取你自己的历史，不会访问工作区、知识库或外部文件。'],
    returns: [
      {
        name: 'hits',
        type: 'Array<{ roundId: number; matchedText: string }>',
        description: '关键词命中的历史轮次与片段。'
      }
    ],
    examples: [
      {
        goal: '搜索之前出现过的 docx_text_edit 历史',
        args: HISTORY_SEARCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: INTERNAL_EXECUTION_META
}

export const HISTORY_LIST_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof historySearchFilterSchema>,
  'history_list',
  'history-recall'
> = {
  name: 'history_list',
  familyId: 'internal',
  skillIds: ['history-recall'],
  requiresWorkspace: false,
  schema: historySearchFilterSchema.omit({ query: true }),
  promptSpec: {
    name: 'history_list',
    purpose: '按 roundId 区间连续查看过程历史；不传参数时默认返回最近几轮。',
    whenToUse: '当你想像往上翻历史一样连续看一段轮次，而不是按关键词搜索时使用。',
    preconditions: ['它只读取你自己的历史，不会访问工作区、知识库或外部文件。'],
    returns: [
      {
        name: 'rounds',
        type: 'Array<HumanRoundRecord>',
        description: '按条件返回的连续历史轮次。'
      }
    ],
    examples: [
      {
        goal: '查看较早一段连续历史',
        args: HISTORY_LIST_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: INTERNAL_EXECUTION_META
}

export const INTERNAL_TOOL_SPECS = [HISTORY_SEARCH_TOOL_SPEC, HISTORY_LIST_TOOL_SPEC] as const
