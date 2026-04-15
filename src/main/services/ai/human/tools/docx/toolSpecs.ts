import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxHeadingEditSchema,
  docxHistoryRequestSchema,
  docxOutlineRequestSchema,
  docxParagraphEditSchema,
  docxReadRequestSchema,
  docxRollbackRequestSchema,
  docxTableEditSchema,
  docxTextEditSchema,
  docxTextStyleEditSchema
} from './schemas'
import {
  createStaticExecutionMetaResolver,
  readStringArg
} from '../utils/toolSpecUtils'

const createDocxReadExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'read_only',
    parallelSafe: true,
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

const createDocxMutatingExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'mutating',
    parallelSafe: false,
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

type DocxToolSpec<
  TArgs extends JsonObject = JsonObject,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TName, TSkillId> & {
  description: string
  activityActionType?: string
}

const DOCX_SOURCE_PATH_EXAMPLE = 'ai/docx/图形学.docx'
const DOCX_READ_QUERY_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  query: '反走样'
}
const DOCX_READ_BLOCK_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  blockId: 'b:26'
}

export const DOCX_OUTLINE_TOOL_SPEC = {
  name: 'docx_outline',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '读取 docx 的整体结构提纲。',
  skillIds: ['docx-read'],
  schema: docxOutlineRequestSchema,
  promptSpec: {
    name: 'docx_outline',
    purpose: '总揽读取 docx 的稳定结构，拿到标题、段落、表格和单元格的 blockId。',
    whenToUse: '当你需要先理解文档结构、定位标题或表格、或为后续精读/编辑拿到 blockId 时使用。',
    preconditions: ['sourcePath 必须是 workspace 内的 .docx 路径。工具会自动打开目标文档。'],
    returns: [
      {
        name: 'blocks',
        type: 'Array<{ blockId: string; type: string; bodyIndex: number; preview: string }>',
        description: '按文档顺序排列的结构块，包含标题层级、表格维度和单元格位置事实。'
      },
      {
        name: 'truncated',
        type: 'boolean',
        description: '是否因 maxBlocks 被截断。'
      }
    ],
    examples: [
      {
        goal: '先看一份 docx 的整体结构和标题、表格分布',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          maxBlocks: 40
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_outline'
} satisfies DocxToolSpec<z.infer<typeof docxOutlineRequestSchema>, 'docx_outline', 'docx-read'>

export const DOCX_READ_TOOL_SPEC = {
  name: 'docx_read',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 query 或 blockId 片段精读 docx。',
  skillIds: ['docx-read'],
  schema: docxReadRequestSchema,
  promptSpec: {
    name: 'docx_read',
    purpose: '读取某个 block，或按 query 查找后返回片段与上下文。',
    whenToUse: '当你已经知道 blockId，或希望通过 query 定位并精读段落、表格、单元格内容时使用。',
    preconditions: ['必须提供 query 或 blockId 其中一个。工具会自动打开目标文档。'],
    returns: [
      {
        name: 'matches',
        type: 'Array<paragraph | table | table_cell>',
        description: '按命中文档顺序返回类型化内容；表格会直接返回二维 rows。'
      },
      {
        name: 'truncated',
        type: 'boolean',
        description: '多命中场景下结果是否被截断。'
      }
    ],
    examples: [
      {
        goal: '按 query 找到“反走样”对应的相关片段',
        args: DOCX_READ_QUERY_EXAMPLE
      },
      {
        goal: '按 blockId 精确读取一个已定位块',
        args: DOCX_READ_BLOCK_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read'
} satisfies DocxToolSpec<z.infer<typeof docxReadRequestSchema>, 'docx_read', 'docx-read'>

export const DOCX_HISTORY_TOOL_SPEC = {
  name: 'docx_history',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '查看当前任务过程中的 docx 版本历史。',
  skillIds: ['docx-read'],
  schema: docxHistoryRequestSchema,
  promptSpec: {
    name: 'docx_history',
    purpose: '查看当前任务过程中这份 docx 的版本链、版本摘要和变更块。',
    whenToUse: '当你要确认编辑历史、比较最近几版差异、或决定回滚到哪个版本时使用。',
    preconditions: ['sourcePath 必须是 workspace 内的 .docx 路径。工具会自动打开目标文档。'],
    returns: [
      {
        name: 'versions',
        type: 'Array<{ versionRef: string; summary: string; changedBlocks: Array<object> }>',
        description: '按当前版本到祖先版本的顺序返回版本链。'
      }
    ],
    examples: [
      {
        goal: '查看最近几个 docx 版本及各自改动摘要',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          limit: 5
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_history'
} satisfies DocxToolSpec<z.infer<typeof docxHistoryRequestSchema>, 'docx_history', 'docx-read'>

export const DOCX_PARAGRAPH_EDIT_TOOL_SPEC = {
  name: 'docx_paragraph_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按段落对象执行插入、替换或删除。',
  skillIds: ['docx-write'],
  schema: docxParagraphEditSchema,
  promptSpec: {
    name: 'docx_paragraph_edit',
    purpose: '按段落对象插入、替换或删除段落文本。',
    whenToUse: '当你已经明确段落锚点或目标 blockId，且只需要插段落、改段落文本或删段落时使用。',
    preconditions: ['插入动作需要 anchorBlockId 与 text；替换/删除需要 blockId。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '本次段落编辑成功后的当前版本。'
      },
      {
        name: 'createdBlocks',
        type: 'Array<{ blockId: string; type: string }>',
        description: '插入动作时创建出来的新块。'
      }
    ],
    examples: [
      {
        goal: '在目标段落后插入一段说明',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          action: 'insert_after',
          anchorBlockId: 'b:26',
          text: '补充说明：反走样通过平滑边缘像素来减轻锯齿感。'
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_paragraph_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxParagraphEditSchema>,
  'docx_paragraph_edit',
  'docx-write'
>

export const DOCX_HEADING_EDIT_TOOL_SPEC = {
  name: 'docx_heading_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按标题对象执行插入或替换。',
  skillIds: ['docx-write'],
  schema: docxHeadingEditSchema,
  promptSpec: {
    name: 'docx_heading_edit',
    purpose: '按标题对象插入或替换标题文本。',
    whenToUse: '当你要在某处插入标题，或把现有标题块替换成新标题文本时使用。',
    preconditions: ['插入动作需要 anchorBlockId；替换动作需要 blockId；level 必须是 1-6。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '本次标题编辑成功后的当前版本。'
      },
      {
        name: 'createdBlocks',
        type: 'Array<{ blockId: string; type: string }>',
        description: '插入动作时创建出来的新标题块。'
      }
    ],
    examples: [
      {
        goal: '在指定 block 后插入一个二级标题',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          action: 'insert_after',
          anchorBlockId: 'b:26',
          level: 2,
          text: '反走样与过拟合对照'
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_heading_edit'
} satisfies DocxToolSpec<z.infer<typeof docxHeadingEditSchema>, 'docx_heading_edit', 'docx-write'>

export const DOCX_TABLE_EDIT_TOOL_SPEC = {
  name: 'docx_table_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按表格对象执行插入或改单元格。',
  skillIds: ['docx-write'],
  schema: docxTableEditSchema,
  promptSpec: {
    name: 'docx_table_edit',
    purpose: '按表格对象插入表格或更新单元格内容。',
    whenToUse: '当你需要插入一个简单二维文本表格，或更新某个 table cell 的内容时使用。',
    preconditions: ['插表动作需要 anchorBlockId 与 rows；改单元格动作需要 cellBlockId 与 text。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '本次表格编辑成功后的当前版本。'
      },
      {
        name: 'createdBlocks',
        type: 'Array<{ blockId: string; type: string }>',
        description: '插表动作时创建出来的新表格块与单元格块。'
      }
    ],
    examples: [
      {
        goal: '在指定 block 后插入一个简单对照表',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          action: 'insert_after',
          anchorBlockId: 'b:26',
          rows: [
            ['反走样', '过拟合'],
            ['平滑图像边缘，降低锯齿', '记住训练噪声，泛化能力下降']
          ]
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_table_edit'
} satisfies DocxToolSpec<z.infer<typeof docxTableEditSchema>, 'docx_table_edit', 'docx-write'>

export const DOCX_TEXT_EDIT_TOOL_SPEC = {
  name: 'docx_text_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 query 执行文本查找替换。',
  skillIds: ['docx-write'],
  schema: docxTextEditSchema,
  promptSpec: {
    name: 'docx_text_edit',
    purpose: '在当前 docx 中按 query 查找并替换文本，可选 blockIds 缩小范围。',
    whenToUse: '当你想在一批命中文本里直接替换术语或改写短句时使用。',
    preconditions: ['query 不能为空。'],
    returns: [
      {
        name: 'changedBlocks',
        type: 'Array<{ blockId: string; beforeText: string; afterText: string }>',
        description: '本次文本替换实际改动到的块。'
      }
    ],
    examples: [
      {
        goal: '把文中的“过拟合”统一替换成“模型过拟合”',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          query: '过拟合',
          replace: '模型过拟合'
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_text_edit'
} satisfies DocxToolSpec<z.infer<typeof docxTextEditSchema>, 'docx_text_edit', 'docx-write'>

export const DOCX_TEXT_STYLE_EDIT_TOOL_SPEC = {
  name: 'docx_text_style_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '在指定块内按 query 命中文本并应用样式。',
  skillIds: ['docx-write'],
  schema: docxTextStyleEditSchema,
  promptSpec: {
    name: 'docx_text_style_edit',
    purpose: '给现有文本片段加颜色、粗体、斜体或下划线，不改文字本身。',
    whenToUse: '当你需要把某一段已有文本标红、加粗或下划线时使用。',
    preconditions: ['必须提供 blockId 与 query；style 至少要有一个字段。'],
    returns: [
      {
        name: 'changedBlocks',
        type: 'Array<{ blockId: string; beforeText: string; afterText: string }>',
        description: '样式修改涉及到的块；文本本身通常不变，但格式会变化。'
      }
    ],
    examples: [
      {
        goal: '把指定段落中“高风险”标红加粗',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          blockId: 'b:26',
          query: '高风险',
          style: {
            color: 'FF0000',
            bold: true
          }
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_text_style_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxTextStyleEditSchema>,
  'docx_text_style_edit',
  'docx-write'
>

export const DOCX_ROLLBACK_TOOL_SPEC = {
  name: 'docx_rollback',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按版本号回退当前 docx 草稿。',
  skillIds: ['docx-write'],
  schema: docxRollbackRequestSchema,
  promptSpec: {
    name: 'docx_rollback',
    purpose: '把当前任务过程中的 docx 草稿切回指定 versionRef，不覆盖原文件。',
    whenToUse: '当你已经通过 docx_history 确认要回退到哪个版本时使用。',
    preconditions: ['必须先有可追溯的版本历史。'],
    returns: [
      {
        name: 'currentVersionRef',
        type: 'string',
        description: '回退后的当前版本。'
      }
    ],
    examples: [
      {
        goal: '把当前草稿回退到指定版本',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          versionRef: 'v2'
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_rollback'
} satisfies DocxToolSpec<z.infer<typeof docxRollbackRequestSchema>, 'docx_rollback', 'docx-write'>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC,
  DOCX_HISTORY_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [
  DOCX_PARAGRAPH_EDIT_TOOL_SPEC,
  DOCX_HEADING_EDIT_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_TEXT_EDIT_TOOL_SPEC,
  DOCX_TEXT_STYLE_EDIT_TOOL_SPEC,
  DOCX_ROLLBACK_TOOL_SPEC
] as const

export const DOCX_TOOL_SPECS = [...DOCX_READ_TOOL_SPECS, ...DOCX_WRITE_TOOL_SPECS] as const

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
