import type { JsonObject } from '../../../../../shared/types'
import type { ToolPromptSpec } from '../types'

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

const TERMINAL_COMMAND_EXAMPLE: JsonObject = {
  command: 'cat ai/workspace/materials/daily/2026-03-16-note.md',
  cwd: '.'
}

const KB_SEARCH_EXAMPLE: JsonObject = {
  queryText: 'approval denied terminal artifact requirement',
  limit: 3
}

const cloneJsonObject = (value: JsonObject): JsonObject => ({ ...value })

const cloneToolPromptSpec = (spec: ToolPromptSpec): ToolPromptSpec => ({
  ...spec,
  preconditions: spec.preconditions ? [...spec.preconditions] : undefined,
  args: spec.args.map((item) => ({
    ...item,
    enumValues: item.enumValues ? [...item.enumValues] : undefined
  })),
  returns: spec.returns.map((item) => ({ ...item })),
  commonMistakes: spec.commonMistakes ? [...spec.commonMistakes] : undefined,
  examples: spec.examples
    ? spec.examples.map((item) => ({
        goal: item.goal,
        args: cloneJsonObject(item.args)
      }))
    : undefined
})

const TOOL_PROMPT_SPECS: Record<string, ToolPromptSpec> = {
  terminal_run_command: {
    name: 'terminal_run_command',
    purpose: '在 workspace 内执行单条 shell 命令，读取文件、检查环境或生成中间产物。',
    whenToUse: '只有当 KB 或 DOCX 工具不能直接完成任务，且确实需要 shell 读取/验证/产出文件时才使用。',
    preconditions: [
      '必须存在 workspace 绑定。',
      'command 必须是单条明确命令，不能靠空命令探测环境。',
      '若会生成文件，优先在 expectedArtifacts 中声明目标产物。'
    ],
    args: [
      {
        name: 'command',
        type: 'string',
        required: true,
        description: '要执行的单条 shell 命令。'
      },
      {
        name: 'cwd',
        type: 'string',
        required: false,
        description: 'workspace 内相对或绝对目录；省略时默认 workspace 根目录。'
      },
      {
        name: 'expectedArtifacts',
        type: 'Array<{ path: string; operation?: "created" | "updated"; summary?: string }>',
        required: false,
        description: '预期会产生或更新的文件，便于产物识别与 artifact 事件落地。'
      }
    ],
    returns: [
      {
        name: 'ok',
        type: 'boolean',
        description: '命令是否成功执行。'
      },
      {
        name: 'outputPreview',
        type: 'string',
        description: 'stdout/stderr 的截断预览，用于后续推理。'
      },
      {
        name: 'artifacts',
        type: 'Array<{ path: string; operation: "created" | "updated" }>',
        description: '检测到并成功记录的文件产物。'
      }
    ],
    commonMistakes: [
      '不要把 shell 当成 KB 检索或 DOCX 编辑的默认入口。',
      '不要把多步流程塞进一条又长又难解释的命令。',
      '命中 approval_denied 或 workspace_required 后不要重复同一命令。'
    ],
    examples: [
      {
        goal: '读取单个 workspace 材料文件',
        args: TERMINAL_COMMAND_EXAMPLE
      }
    ]
  },
  docx_open: {
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
  docx_outline: {
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
  docx_get_block: {
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
  docx_search: {
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
  docx_apply_ops: {
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
      'replace_text 用 query/replace，不要误写成 source/target。',
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
      }
    ]
  },
  docx_get_history: {
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
  docx_rollback: {
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
  docx_render_preview: {
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
  docx_save: {
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
  docx_validate: {
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
  kb_hybrid_search_chunks: {
    name: 'kb_hybrid_search_chunks',
    purpose: '在本地知识库上做 hybrid 检索，综合关键词与向量召回。',
    whenToUse: '默认首选的 KB 检索入口；需要先召回本地证据时优先使用。',
    preconditions: ['queryText 不能为空。', '如果 selectedDocumentIds 已存在，检索会自动受其约束。'],
    args: [
      {
        name: 'queryText',
        type: 'string',
        required: true,
        description: '检索问题或关键词。'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: '最多返回多少个 chunk，默认 10，上限 50。'
      },
      {
        name: 'sourceType',
        type: '"all" | "file" | "web"',
        required: false,
        description: '限定来源类型。',
        enumValues: ['all', 'file', 'web']
      },
      {
        name: 'documentIds',
        type: 'string[]',
        required: false,
        description: '进一步缩小到指定文档 ID 列表。'
      }
    ],
    returns: [
      {
        name: 'rows',
        type: 'Array<{ text: string; document_id: string; document_name: string; source_type: string; _score: number }>',
        description: '命中的知识片段列表。'
      }
    ],
    commonMistakes: [
      '如果已有单文档命中证据，不要再重复检索或改用 list_documents 再确认一次。',
      'documentIds 只能缩小范围，不能跳出当前 selectedDocumentIds。'
    ],
    examples: [
      {
        goal: '在当前范围内检索 approval denied 相关规范',
        args: KB_SEARCH_EXAMPLE
      }
    ]
  },
  kb_vector_search_chunks: {
    name: 'kb_vector_search_chunks',
    purpose: '做纯向量语义检索。',
    whenToUse: 'hybrid 没召回到语义相近内容，但你仍需要更宽松的语义匹配时使用。',
    preconditions: ['queryText 不能为空。'],
    args: [
      {
        name: 'queryText',
        type: 'string',
        required: true,
        description: '语义检索查询。'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: '最多返回多少个 chunk，默认 10，上限 50。'
      },
      {
        name: 'sourceType',
        type: '"all" | "file" | "web"',
        required: false,
        description: '限定来源类型。',
        enumValues: ['all', 'file', 'web']
      },
      {
        name: 'documentIds',
        type: 'string[]',
        required: false,
        description: '进一步缩小到指定文档 ID 列表。'
      }
    ],
    returns: [
      {
        name: 'rows',
        type: 'Array<chunk result>',
        description: '命中的知识片段列表。'
      }
    ],
    commonMistakes: ['不要把 vector 当成默认第一步；通常先用 hybrid。']
  },
  kb_fts_search_chunks: {
    name: 'kb_fts_search_chunks',
    purpose: '做纯关键词全文检索。',
    whenToUse: '需要精确关键词命中、固定短语、或明确术语检索时使用。',
    preconditions: ['queryText 不能为空。'],
    args: [
      {
        name: 'queryText',
        type: 'string',
        required: true,
        description: '关键词检索查询。'
      },
      {
        name: 'limit',
        type: 'number',
        required: false,
        description: '最多返回多少个 chunk，默认 10，上限 50。'
      },
      {
        name: 'sourceType',
        type: '"all" | "file" | "web"',
        required: false,
        description: '限定来源类型。',
        enumValues: ['all', 'file', 'web']
      },
      {
        name: 'documentIds',
        type: 'string[]',
        required: false,
        description: '进一步缩小到指定文档 ID 列表。'
      }
    ],
    returns: [
      {
        name: 'rows',
        type: 'Array<chunk result>',
        description: '命中的知识片段列表。'
      }
    ],
    commonMistakes: ['如果用户诉求是“找相近语义”，不要先上 fts。']
  },
  kb_list_documents: {
    name: 'kb_list_documents',
    purpose: '列出当前范围内的知识库文档。',
    whenToUse: '只有在资料范围不清楚、需要先找候选文档、或 search 结果为空时使用。',
    preconditions: ['若 selectedDocumentIds 已固定且 search 已命中文档，通常不需要再 list_documents。'],
    args: [
      {
        name: 'keyword',
        type: 'string',
        required: false,
        description: '按文档名关键词过滤。'
      },
      {
        name: 'page',
        type: 'number',
        required: false,
        description: '页码，默认 1。'
      },
      {
        name: 'pageSize',
        type: 'number',
        required: false,
        description: '每页数量，默认 20，上限 50。'
      },
      {
        name: 'documentIds',
        type: 'string[]',
        required: false,
        description: '进一步缩小到指定文档 ID 列表。'
      }
    ],
    returns: [
      {
        name: 'items',
        type: 'Array<{ id: string; name: string; source_type: string }>',
        description: '文档列表。'
      },
      {
        name: 'total',
        type: 'number',
        description: '命中文档总数。'
      }
    ],
    commonMistakes: ['不要在已经拿到明确 chunk 证据后再 list_documents 做重复确认。']
  }
}

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const matched = TOOL_PROMPT_SPECS[toolName]
  return matched ? cloneToolPromptSpec(matched) : null
}
