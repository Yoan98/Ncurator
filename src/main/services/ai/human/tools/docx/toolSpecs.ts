import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  applyOpsSchema,
  getBlockSchema,
  historySchema,
  openSchema,
  outlineSchema,
  rollbackSchema,
  searchSchema
} from './schemas'
import {
  createStaticExecutionMetaResolver,
  readStringArg
} from '../utils/toolSpecUtils'
import type { DocxWorkerAction } from './worker/types'

const createDocxReadExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'read_only',
    parallelSafe: true,
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

const createDocxMutatingExecutionMeta = (input: {
  getResourceKey?: (args: JsonObject) => string | undefined
}) =>
  createStaticExecutionMetaResolver({
    mutability: 'mutating',
    parallelSafe: false,
    getResourceKey: input.getResourceKey,
    defaultResourceKey: 'docx'
  })

type DocxToolSpec<
  TArgs extends JsonObject = JsonObject,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TName, TSkillId> & {
  description: string
  workerAction?: Exclude<DocxWorkerAction, 'release_run'>
  activityActionType?: string
}

const DOCX_SOURCE_PATH_EXAMPLE = 'ai/docx/图形学.docx'
const DOCX_OPEN_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE
}
const DOCX_OUTLINE_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  maxBlocks: 40,
  includeTables: true
}
const DOCX_GET_BLOCK_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  blockId: 'b:26'
}
const DOCX_SEARCH_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  query: '反走样',
  mode: 'literal'
}
const DOCX_HISTORY_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  maxDepth: 5
}
const DOCX_APPLY_OPS_INSERT_STRUCTURE_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  ops: [
    {
      type: 'insert_after',
      anchorBlockId: 'b:26',
      content: [
        {
          kind: 'paragraph',
          runs: [
            {
              text: '补充说明：反走样通过平滑边缘像素来减轻锯齿感。'
            }
          ]
        },
        {
          kind: 'table',
          rows: [
            [
              {
                paragraphs: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: '反走样' }]
                  }
                ]
              },
              {
                paragraphs: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: '过拟合' }]
                  }
                ]
              }
            ],
            [
              {
                paragraphs: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: '平滑图像边缘，降低锯齿' }]
                  }
                ]
              },
              {
                paragraphs: [
                  {
                    kind: 'paragraph',
                    runs: [{ text: '记住训练噪声，泛化能力下降' }]
                  }
                ]
              }
            ]
          ]
        }
      ]
    }
  ]
}
const DOCX_ROLLBACK_TARGET_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  targetVersionRef: 'v2'
}
export const DOCX_OPEN_TOOL_SPEC = {
  name: 'docx_open',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '初始化或复用指定文档的 docx 会话，并返回当前版本。',
  skillIds: ['docx-read'],
  schema: openSchema,
  promptSpec: {
    name: 'docx_open',
    purpose: '初始化或复用当前任务过程中的某份 docx 文档会话，并返回当前版本。',
    whenToUse: '首次把某份 docx 纳入当前任务过程，或需要确认这份文档当前版本时使用。',
    preconditions: ['必须存在 workspace 绑定。', 'sourcePath 必须是 workspace 内的 .docx 路径。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '当前任务过程中该文档当前活动版本的引用。'
      },
      {
        name: 'meta',
        type: 'object',
        description: '文档元信息，如 title、creator、defaultFont。'
      },
      {
        name: 'stats',
        type: 'object',
        description: '文档统计信息，如 blockCount、tableCount、charCount。'
      }
    ],
    examples: [
      {
        goal: '把工作区中的 docx 文档纳入当前任务会话',
        args: DOCX_OPEN_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'sourcePath')
  }),
  workerAction: 'open',
  activityActionType: 'docx_open'
} satisfies DocxToolSpec<z.infer<typeof openSchema>, 'docx_open', 'docx-read'>

export const DOCX_OUTLINE_TOOL_SPEC = {
  name: 'docx_outline',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 sourcePath 提取已打开 docx 的稳定结构提纲。',
  skillIds: ['docx-read'],
  schema: outlineSchema,
  promptSpec: {
    name: 'docx_outline',
    purpose: '提取稳定的 block outline，帮助定位标题、段落、表格和 table cell。',
    whenToUse: '需要先看结构、拿稳定 blockId、或搜索命中不够精确时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。'],
    returns: [
      {
        name: 'blocks',
        type: 'Array<outline block>',
        description:
          '按文档顺序排列的结构块；每个块都带 blockId、type、bodyIndex 以及相邻 body block 事实。'
      },
      {
        name: 'truncated',
        type: 'boolean',
        description: '返回是否因 maxBlocks 被截断；若为 true，表示文档后续内容未包含在这次 outline 结果中。'
      }
    ],
    examples: [
      {
        goal: '查看一份 docx 的结构提纲并展开表格',
        args: DOCX_OUTLINE_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'outline',
  activityActionType: 'docx_outline'
} satisfies DocxToolSpec<z.infer<typeof outlineSchema>, 'docx_outline', 'docx-read'>

export const DOCX_GET_BLOCK_TOOL_SPEC = {
  name: 'docx_get_block',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 blockId 读取指定 docx 当前版本中的单个 block 详细结构。',
  skillIds: ['docx-read'],
  schema: getBlockSchema,
  promptSpec: {
    name: 'docx_get_block',
    purpose: '读取单个 block 的详细结构。',
    whenToUse: '已经拿到 blockId，且需要看完整段落 run 或表格 cell 内容时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。', '必须提供 blockId。'],
    returns: [
      {
        name: 'block',
        type: 'detailed block object',
        description: '段落、表格或表格单元格的详细结构内容，并包含 bodyIndex 与相邻 body block 事实。'
      }
    ],
    examples: [
      {
        goal: '读取已经定位到的 block 详细内容',
        args: DOCX_GET_BLOCK_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'get_block'
} satisfies DocxToolSpec<z.infer<typeof getBlockSchema>, 'docx_get_block', 'docx-read'>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 literal、regex 或 semantic 模式检索指定 docx 当前版本中的 block。',
  skillIds: ['docx-read'],
  schema: searchSchema,
  promptSpec: {
    name: 'docx_search',
    purpose: '按 literal / regex / semantic 检索 docx block 文本。',
    whenToUse: '需要定位目标段落、验证改写结果、或缩小 apply_ops 范围时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。', 'query 不能为空。'],
    returns: [
      {
        name: 'matches',
        type: 'Array<{ blockId: string; blockType: string; bodyIndex: number; previousBodyBlockId?: string; nextBodyBlockId?: string; tableBlockId?: string; text: string; offsets: Array<{ start: number; end: number }> }>',
        description: '命中的 block、偏移信息，以及该 block 在文档结构中的位置事实。'
      }
    ],
    examples: [
      {
        goal: '按文字检索 docx 中与反走样相关的 block',
        args: DOCX_SEARCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'search'
} satisfies DocxToolSpec<z.infer<typeof searchSchema>, 'docx_search', 'docx-read'>

export const DOCX_GET_HISTORY_TOOL_SPEC = {
  name: 'docx_get_history',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '查看指定 docx 在当前任务过程中的当前版本链路。',
  skillIds: ['docx-read'],
  schema: historySchema,
  promptSpec: {
    name: 'docx_get_history',
    purpose: '查看当前任务过程中某份 docx 的当前版本链路。',
    whenToUse: '需要确认编辑历史、准备 rollback、或解释当前草稿来源时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。'],
    returns: [
      {
        name: 'versions',
        type: 'Array<{ versionRef: string; parentVersionRef?: string; createdAt: number; isCurrent: boolean }>',
        description: '当前版本到祖先版本的历史链路。'
      }
    ],
    examples: [
      {
        goal: '查看当前 docx 会话的最近版本链路',
        args: DOCX_HISTORY_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta()
} satisfies DocxToolSpec<z.infer<typeof historySchema>, 'docx_get_history', 'docx-read'>

export const DOCX_APPLY_OPS_TOOL_SPEC = {
  name: 'docx_apply_ops',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '对指定 docx 当前版本执行结构化编辑，并推进版本链。',
  skillIds: ['docx-write'],
  schema: applyOpsSchema,
  promptSpec: {
    name: 'docx_apply_ops',
    purpose: '执行结构化 docx 编辑操作，并返回新的当前版本。',
    whenToUse: '已经确定要替换、插入、删除或更新表格内容时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。', 'ops 至少要有 1 条。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '编辑后的当前版本引用。后续读取、继续编辑或回滚都基于它继续。'
      },
      {
        name: 'changedBlocks',
        type: 'Array<{ action: string; blockId: string; beforeText: string; afterText: string }>',
        description: '本次变更涉及的 block 摘要。'
      },
      {
        name: 'warnings',
        type: 'string[]',
        description: '非致命提示信息。'
      }
    ],
    examples: [
      {
        goal: '在指定 block 后插入说明段落和表格结构',
        args: DOCX_APPLY_OPS_INSERT_STRUCTURE_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'sourcePath')
  }),
  workerAction: 'apply_ops',
  activityActionType: 'docx_apply_ops'
} satisfies DocxToolSpec<z.infer<typeof applyOpsSchema>, 'docx_apply_ops', 'docx-write'>

export const DOCX_ROLLBACK_TOOL_SPEC = {
  name: 'docx_rollback',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '在当前任务过程中把指定 docx 回退到祖先版本，不写回文件系统。',
  skillIds: ['docx-write'],
  schema: rollbackSchema,
  promptSpec: {
    name: 'docx_rollback',
    purpose: '回退到当前任务过程中的祖先版本，不会写回文件系统。',
    whenToUse: '草稿改坏了、需要回看上一个版本、或用户要求撤销时使用。',
    preconditions: ['必须先 open 目标 sourcePath 对应的文档。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '回退后的当前版本引用。'
      }
    ],
    examples: [
      {
        goal: '直接回退到指定祖先版本',
        args: DOCX_ROLLBACK_TARGET_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'sourcePath')
  }),
  activityActionType: 'docx_rollback'
} satisfies DocxToolSpec<z.infer<typeof rollbackSchema>, 'docx_rollback', 'docx-write'>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_OPEN_TOOL_SPEC,
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_GET_BLOCK_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_GET_HISTORY_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [DOCX_APPLY_OPS_TOOL_SPEC, DOCX_ROLLBACK_TOOL_SPEC] as const

export const DOCX_TOOL_SPECS = [
  ...DOCX_READ_TOOL_SPECS,
  ...DOCX_WRITE_TOOL_SPECS
] as const

export type AnyDocxToolSpec = (typeof DOCX_TOOL_SPECS)[number]
export type DocxToolName = AnyDocxToolSpec['name']

const DOCX_TOOL_SPEC_BY_NAME = new Map<DocxToolName, AnyDocxToolSpec>(
  DOCX_TOOL_SPECS.map((spec) => [spec.name, spec])
)

export function getDocxToolSpec<TName extends DocxToolName>(
  name: TName
): Extract<AnyDocxToolSpec, { name: TName }> {
  const spec = DOCX_TOOL_SPEC_BY_NAME.get(name)
  if (!spec) {
    throw new Error(`missing docx tool spec for ${name}`)
  }
  return spec as Extract<AnyDocxToolSpec, { name: TName }>
}
