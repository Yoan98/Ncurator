import type { JsonObject } from '../../../../../../shared/types'
import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'
import { historyRecallFilterSchema } from '../../schema'

const HISTORY_RECALL_EXAMPLE: JsonObject = {
  executionKinds: ['hand'],
  toolNames: ['docx_apply_ops'],
  limit: 2
}

const INTERNAL_EXECUTION_META = createStaticExecutionMetaResolver({
  mutability: 'read_only',
  parallelSafe: true,
  defaultResourceKey: 'human-round-history'
})

export const HISTORY_RECALL_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof historyRecallFilterSchema>,
  'history_recall',
  'history-recall'
> = {
  name: 'history_recall',
  familyId: 'internal',
  skillIds: ['history-recall'],
  requiresWorkspace: false,
  schema: historyRecallFilterSchema,
  promptSpec: {
    name: 'history_recall',
    purpose: '从你自己的过程历史里加载更详细的旧轮次信息。',
    whenToUse: '当上一轮和历史链仍不足以判断下一步，且你明确需要查看更多旧轮次细节时使用。',
    preconditions: [
      '优先先看 last_round_focus 和 history_chain。',
      '它只读取你自己的历史，不会访问工作区、知识库或外部文件。'
    ],
    args: [
      {
        name: 'roundIds',
        type: 'number[]',
        required: false,
        description: '限定要回看的轮次编号。'
      },
      {
        name: 'executionKinds',
        type: '"pre_execution_blocked" | "learning" | "hand" | "mouth"[]',
        required: false,
        description: '限定执行类型。'
      },
      {
        name: 'toolNames',
        type: 'string[]',
        required: false,
        description: '限定包含指定工具名的 hand 轮次。'
      },
      {
        name: 'watchHintCodes',
        type: 'string[]',
        required: false,
        description: '限定包含指定收敛提示的轮次。'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: '最多加载多少轮详细历史。默认 3。'
      }
    ],
    returns: [
      {
        name: 'rounds',
        type: 'Array<HumanRoundRecord>',
        description: '匹配条件的历史轮次。'
      }
    ],
    examples: [
      {
        goal: '回看最近几轮中与 docx 编辑相关的详细执行结果',
        args: HISTORY_RECALL_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: INTERNAL_EXECUTION_META
}

export const INTERNAL_TOOL_SPECS = [HISTORY_RECALL_TOOL_SPEC] as const
