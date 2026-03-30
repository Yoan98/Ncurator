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
  renderPreviewSchema,
  rollbackSchema,
  saveSchema,
  searchSchema,
  validateSchema
} from './schemas'
import {
  createStaticExecutionMetaResolver,
  readStringArg
} from '../utils/toolSpecUtils'
import type { DocxWorkerAction } from './worker/types'

const DOCX_REPLACE_TEXT_EXAMPLE: JsonObject = {
  ops: [
    {
      type: 'replace_text',
      query: 'Checklist summary: pending policy sync.',
      replace:
        'Checklist summary: Mention approval-denied coverage and terminal artifact assertion before sign-off.'
    }
  ]
}

const DOCX_UPDATE_TABLE_CELL_EXAMPLE: JsonObject = {
  ops: [
    {
      type: 'update_table_cell',
      blockId: 'tbl:3.r:1.c:1',
      content: [
        {
          kind: 'paragraph',
          runs: [{ text: 'Bob' }]
        }
      ]
    }
  ]
}

const DOCX_REPLACE_TODO_BATCH_EXAMPLE: JsonObject = {
  ops: [
    {
      type: 'replace_text',
      query: '{{OWNER}}',
      replace: 'Alice'
    },
    {
      type: 'replace_text',
      query: '{{DUE_DATE}}',
      replace: '2026-03-30'
    }
  ]
}

const createDocxReadExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'read_only',
    parallelSafe: true,
    getResourceKey: (args) => readStringArg(args, 'docId'),
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

export const DOCX_OPEN_TOOL_SPEC = {
  name: 'docx_open',
  familyId: 'docx',
  requiresWorkspace: true,
  description: 'Open a workspace-bound docx file and register a docId for subsequent operations.',
  skillIds: ['docx-read'],
  schema: openSchema,
  promptSpec: {
    name: 'docx_open',
    purpose: '打开 workspace 内的 docx 文件，并注册后续操作使用的 docId。',
    whenToUse: '任何 docx_* 工具链的第一步；切换到另一份文档时也必须重新 open。',
    preconditions: ['必须存在 workspace 绑定。', 'sourcePath 必须是 workspace 内的 .docx 路径。'],
    args: [
      {
        name: 'sourcePath',
        type: 'string',
        required: true,
        description: '目标 docx 的相对或绝对 workspace 路径。'
      }
    ],
    returns: [
      {
        name: 'docId',
        type: 'string',
        description: '后续 outline/search/apply/save/preview/validate 使用的快照 ID。'
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
    commonMistakes: [
      '不要在 open 之前调用其他 docx_* 工具。',
      '不要传空路径或非 .docx 文件。'
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
  description:
    'Extract a deterministic block outline for a previously opened doc (paragraph/table/table_cell).',
  skillIds: ['docx-read'],
  schema: outlineSchema,
  promptSpec: {
    name: 'docx_outline',
    purpose: '提取稳定的 block outline，帮助定位标题、段落、表格和 table cell。',
    whenToUse: '需要先看结构、拿稳定 blockId、或搜索命中不够精确时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'maxBlocks',
        type: 'number',
        required: false,
        description: '最多返回多少个 block，范围 1-2000。'
      },
      {
        name: 'includeTables',
        type: 'boolean',
        required: false,
        description: '是否返回 table block。'
      },
      {
        name: 'includeCells',
        type: 'boolean',
        required: false,
        description: '是否展开 table cell block。'
      }
    ],
    returns: [
      {
        name: 'blocks',
        type: 'Array<outline block>',
        description: '按文档顺序排列的结构块，每个块带 blockId/type/preview。'
      },
      {
        name: 'truncated',
        type: 'boolean',
        description: '返回是否因 maxBlocks 被截断。'
      }
    ],
    commonMistakes: ['如果任务已给出精确原文，可 open 后直接 apply_ops，不必先 outline。']
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'outline',
  activityActionType: 'docx_outline'
} satisfies DocxToolSpec<z.infer<typeof outlineSchema>, 'docx_outline', 'docx-read'>

export const DOCX_GET_BLOCK_TOOL_SPEC = {
  name: 'docx_get_block',
  familyId: 'docx',
  requiresWorkspace: true,
  description: 'Get one block by blockId with detailed structure.',
  skillIds: ['docx-read'],
  schema: getBlockSchema,
  promptSpec: {
    name: 'docx_get_block',
    purpose: '读取单个 block 的详细结构。',
    whenToUse: '已经拿到 blockId，且需要看完整段落 run 或表格 cell 内容时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。', '必须提供 blockId。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'blockId',
        type: 'string',
        required: true,
        description: '目标 block 的稳定标识。'
      }
    ],
    returns: [
      {
        name: 'block',
        type: 'detailed block object',
        description: '段落或表格的详细结构内容。'
      }
    ],
    commonMistakes: ['不要在没有 blockId 的情况下调用。']
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'get_block'
} satisfies DocxToolSpec<z.infer<typeof getBlockSchema>, 'docx_get_block', 'docx-read'>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  requiresWorkspace: true,
  description:
    'Search blocks in a doc using literal/regex mode, or semantic block retrieval with cached embeddings.',
  skillIds: ['docx-read'],
  schema: searchSchema,
  promptSpec: {
    name: 'docx_search',
    purpose: '按 literal / regex / semantic 检索 docx block 文本。',
    whenToUse: '需要定位目标段落、验证改写结果、或缩小 apply_ops 范围时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。', 'query 不能为空。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'query',
        type: 'string',
        required: true,
        description: '要检索的文本或模式。'
      },
      {
        name: 'mode',
        type: '"literal" | "regex" | "semantic"',
        required: true,
        description: 'literal 精确文本，regex 正则表达式，semantic 语义相近检索。',
        enumValues: ['literal', 'regex', 'semantic']
      },
      {
        name: 'scope',
        type: '{ blockIds?: string[] }',
        required: false,
        description: '限制在指定 blockIds 范围内检索。'
      }
    ],
    returns: [
      {
        name: 'matches',
        type: 'Array<{ blockId: string; text: string; offsets: Array<{ start: number; end: number }> }>',
        description: '命中的 block 列表及偏移信息。'
      }
    ],
    commonMistakes: [
      '不要把 query 写成空字符串。',
      'semantic 适合找相近语义，literal/regex 更适合稳定定位。'
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'search'
} satisfies DocxToolSpec<z.infer<typeof searchSchema>, 'docx_search', 'docx-read'>

export const DOCX_GET_HISTORY_TOOL_SPEC = {
  name: 'docx_get_history',
  familyId: 'docx',
  requiresWorkspace: true,
  description:
    'Inspect the immutable docx snapshot lineage for the current run. Useful for confirm/rollback flows before save.',
  skillIds: ['docx-read'],
  schema: historySchema,
  promptSpec: {
    name: 'docx_get_history',
    purpose: '查看当前 run 内的 docx 快照链路。',
    whenToUse: '需要确认编辑历史、准备 rollback、或解释当前草稿来源时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'maxDepth',
        type: 'number',
        required: false,
        description: '最多返回多少层祖先快照，范围 1-100。'
      }
    ],
    returns: [
      {
        name: 'snapshots',
        type: 'Array<{ docId: string; parentDocId?: string; createdAt: number }>',
        description: '当前快照到祖先快照的历史链路。'
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta()
} satisfies DocxToolSpec<z.infer<typeof historySchema>, 'docx_get_history', 'docx-read'>

export const DOCX_APPLY_OPS_TOOL_SPEC = {
  name: 'docx_apply_ops',
  familyId: 'docx',
  requiresWorkspace: true,
  description:
    'Apply structured docx operations and return a new immutable docId snapshot with changed blocks.',
  skillIds: ['docx-write'],
  schema: applyOpsSchema,
  promptSpec: {
    name: 'docx_apply_ops',
    purpose: '执行结构化 docx 编辑操作，并返回新的不可变 docId 快照。',
    whenToUse: '已经确定要替换、插入、删除或更新表格内容时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。', 'ops 至少要有 1 条。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'ops',
        type: 'DocxOp[]',
        required: true,
        description:
          '支持 replace_text、replace_block、insert_after、insert_before、delete_block、update_table_cell 六种操作。'
      }
    ],
    returns: [
      {
        name: 'newDocId',
        type: 'string',
        description: '编辑后的新快照 ID。后续 preview/save/validate 基于它继续。'
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
    commonMistakes: [
      'replace_text 的最小合法结构是 type/query/replace，不要缺少 type，也不要误写成 source/target。',
      'update_table_cell 的 content 必须是 paragraph 数组，不是纯字符串。',
      'apply_ops 后会产生 newDocId；后续若显式传 docId，应使用最新快照。'
    ],
    examples: [
      {
        goal: '按原文做精确文本替换',
        args: DOCX_REPLACE_TEXT_EXAMPLE
      },
      {
        goal: '更新表格单元格为 Bob',
        args: DOCX_UPDATE_TABLE_CELL_EXAMPLE
      },
      {
        goal: '批量替换两个占位符',
        args: DOCX_REPLACE_TODO_BATCH_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'docId')
  }),
  workerAction: 'apply_ops',
  activityActionType: 'docx_apply_ops'
} satisfies DocxToolSpec<z.infer<typeof applyOpsSchema>, 'docx_apply_ops', 'docx-write'>

export const DOCX_ROLLBACK_TOOL_SPEC = {
  name: 'docx_rollback',
  familyId: 'docx',
  requiresWorkspace: true,
  description:
    'Move back to an ancestor docx snapshot in the current run without writing files. Use before user confirmation.',
  skillIds: ['docx-write'],
  schema: rollbackSchema,
  promptSpec: {
    name: 'docx_rollback',
    purpose: '回退到当前 run 内的祖先草稿快照，不会写回文件系统。',
    whenToUse: '草稿改坏了、需要回看上一个版本、或用户要求撤销时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '起始快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'targetDocId',
        type: 'string',
        required: false,
        description: '直接回退到指定祖先快照。'
      },
      {
        name: 'steps',
        type: 'number',
        required: false,
        description: '从当前快照向前回退多少步。targetDocId 与 steps 至少二选一。'
      }
    ],
    returns: [
      {
        name: 'docId',
        type: 'string',
        description: '回退后的当前草稿快照 ID。'
      }
    ],
    commonMistakes: ['rollback 只影响当前 run 内草稿，不会直接恢复磁盘上的原文件。']
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'docId') || readStringArg(args, 'targetDocId')
  }),
  activityActionType: 'docx_rollback'
} satisfies DocxToolSpec<z.infer<typeof rollbackSchema>, 'docx_rollback', 'docx-write'>

export const DOCX_RENDER_PREVIEW_TOOL_SPEC = {
  name: 'docx_render_preview',
  familyId: 'docx',
  requiresWorkspace: true,
  description:
    'Render preview artifact for the current doc snapshot. html returns a preview docx artifact path for renderer.',
  skillIds: ['docx-delivery'],
  schema: renderPreviewSchema,
  promptSpec: {
    name: 'docx_render_preview',
    purpose: '为当前 docx 草稿生成可审阅 preview artifact。',
    whenToUse: '完成编辑后，需要给用户 preview/handoff，而不是立即 save 时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。', 'format 必须是支持的预览格式。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      },
      {
        name: 'format',
        type: '"html" | "png" | "pdf"',
        required: true,
        description: '预览格式。',
        enumValues: ['html', 'png', 'pdf']
      },
      {
        name: 'range',
        type: '{ fromBlockId?: string; toBlockId?: string }',
        required: false,
        description: '可选的 block 范围，仅渲染局部。'
      }
    ],
    returns: [
      {
        name: 'previewPath',
        type: 'string',
        description: '生成的 preview artifact 路径。'
      },
      {
        name: 'renderer',
        type: 'string',
        description: '用于生成 preview 的渲染器标识。'
      }
    ],
    commonMistakes: ['如果任务只要求 preview，不要额外 save。']
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'docId')
  }),
  workerAction: 'render_preview'
} satisfies DocxToolSpec<z.infer<typeof renderPreviewSchema>, 'docx_render_preview', 'docx-delivery'>

export const DOCX_SAVE_TOOL_SPEC = {
  name: 'docx_save',
  familyId: 'docx',
  requiresWorkspace: true,
  description: 'Save doc snapshot to a workspace docx path with overwrite approval guard.',
  skillIds: ['docx-delivery'],
  schema: saveSchema,
  promptSpec: {
    name: 'docx_save',
    purpose: '把当前 docx 草稿快照保存到 workspace 中的 .docx 路径。',
    whenToUse: '只有当任务明确要求产出新文件或落盘结果时才使用。',
    preconditions: ['必须提供 docId。', 'outPath 必须是 workspace 内的 .docx 路径。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: true,
        description: '要保存的草稿快照 ID。'
      },
      {
        name: 'outPath',
        type: 'string',
        required: true,
        description: '目标输出路径；参数名必须是 outPath。'
      },
      {
        name: 'overwrite',
        type: 'boolean',
        required: false,
        description: '若目标已存在，是否允许覆盖；覆盖会触发审批。'
      }
    ],
    returns: [
      {
        name: 'outPath',
        type: 'string',
        description: '实际保存路径。'
      },
      {
        name: 'operation',
        type: '"created" | "updated"',
        description: '本次保存是新建还是覆盖更新。'
      }
    ],
    commonMistakes: [
      '不要把参数写成 targetPath 或 savePath；这里只认 outPath。',
      'preview/handoff 任务默认不需要 save。'
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta({
    getResourceKey: (args) => readStringArg(args, 'outPath') || readStringArg(args, 'docId')
  }),
  workerAction: 'save'
} satisfies DocxToolSpec<z.infer<typeof saveSchema>, 'docx_save', 'docx-delivery'>

export const DOCX_VALIDATE_TOOL_SPEC = {
  name: 'docx_validate',
  familyId: 'docx',
  requiresWorkspace: true,
  description: 'Validate current doc snapshot structure and relationship consistency.',
  skillIds: ['docx-delivery'],
  schema: validateSchema,
  promptSpec: {
    name: 'docx_validate',
    purpose: '校验当前 docx 草稿结构与关系是否一致。',
    whenToUse: '编辑完成后、save 前、或需要确认结构有效时使用。',
    preconditions: ['必须先 open 文档，或提供当前 run 中有效的 docId。'],
    args: [
      {
        name: 'docId',
        type: 'string',
        required: false,
        description: '目标快照 ID；省略时默认使用最近一次 docId。'
      }
    ],
    returns: [
      {
        name: 'problems',
        type: 'Array<{ code: string; message: string }>',
        description: '校验问题列表；空数组表示通过。'
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  workerAction: 'validate'
} satisfies DocxToolSpec<z.infer<typeof validateSchema>, 'docx_validate', 'docx-delivery'>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_OPEN_TOOL_SPEC,
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_GET_BLOCK_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_GET_HISTORY_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [DOCX_APPLY_OPS_TOOL_SPEC, DOCX_ROLLBACK_TOOL_SPEC] as const

export const DOCX_DELIVERY_TOOL_SPECS = [
  DOCX_RENDER_PREVIEW_TOOL_SPEC,
  DOCX_SAVE_TOOL_SPEC,
  DOCX_VALIDATE_TOOL_SPEC
] as const

export const DOCX_TOOL_SPECS = [
  ...DOCX_READ_TOOL_SPECS,
  ...DOCX_WRITE_TOOL_SPECS,
  ...DOCX_DELIVERY_TOOL_SPECS
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
