import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxCreateSchema,
  docxDeleteSchema,
  docxHeadingEditSchema,
  docxHistoryRequestSchema,
  docxOutlineRequestSchema,
  docxParagraphEditSchema,
  docxReadRequestSchema,
  docxSearchRequestSchema,
  docxRollbackRequestSchema,
  docxTableEditSchema,
  docxTextEditSchema,
  docxTextStyleEditSchema
} from './schemas'
import {
  createStaticExecutionMetaResolver,
  readStringArg
} from '../utils/toolSpecUtils'
import {
  docxHistoryOutputSchema,
  docxOutlineOutputSchema,
  docxReadBlocksOutputSchema,
  docxRollbackOutputSchema,
  docxSearchOutputSchema,
  docxWriteOutputSchema
} from './outputSchemas'

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
  TOutput extends JsonObject = JsonObject,
  TName extends string = string,
  TSkillId extends RuntimeSkillId = RuntimeSkillId
> = HumanToolSpec<TArgs, TOutput, TName, TSkillId> & {
  description: string
  activityActionType?: string
}

const DOCX_SOURCE_PATH_EXAMPLE = '学习笔记/图形学.docx'
const DOCX_CREATE_TARGET_EXAMPLE = '深度学习与图形学复习总结.docx'
const DOCX_CREATE_EXAMPLE_ARGS: JsonObject = {
  sourcePath: DOCX_CREATE_TARGET_EXAMPLE,
  blocks: [
    {
      type: 'heading',
      level: 1,
      text: '深度学习与图形学复习总结'
    },
    {
      type: 'paragraph',
      text: '请根据已选课件整理关键概念、出现原因和常见处理方式。'
    }
  ]
}
const DOCX_SEARCH_LITERAL_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  query: '反走样'
}
const DOCX_SEARCH_REGEX_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  query: '反.*样',
  mode: 'regex'
}
const DOCX_SEARCH_SEMANTIC_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  query: '边缘锯齿怎么处理',
  mode: 'semantic'
}
const DOCX_READ_RANGE_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  range: {
    type: 'block_index',
    fromBlockIndex: 19,
    toBlockIndex: 26
  }
}

export const DOCX_OUTLINE_TOOL_SPEC = {
  name: 'docx_outline',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '读取 docx 的整体结构提纲。',
  skillIds: ['docx-read'],
  inputSchema: docxOutlineRequestSchema,
  outputSchema: docxOutlineOutputSchema,
  promptSpec: {
    name: 'docx_outline',
    description:
      '能力：按 percent 或 blockIndex 范围读取 sourcePath 对应 docx 的块级 outline。\n结果：返回范围内每个块的文本内容、块级定位信息和结构类型信息。\n边界：返回块级文本与结构概览，不包含 runs 或表格单元格内的详细段落结构。',
    whenToUse: '适用于需要 docx 块级 outline 信息的任务。',
    examples: [
      {
        goal: '先看一份 docx 的整体结构和标题、表格分布',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          ranges: [{ type: 'percent', fromPercent: 0, toPercent: 20 }]
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_outline'
} satisfies DocxToolSpec<
  z.infer<typeof docxOutlineRequestSchema>,
  z.infer<typeof docxOutlineOutputSchema>,
  'docx_outline',
  'docx-read'
>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '在 docx 中定位相关内容，支持 literal / regex / semantic 三种模式。',
  skillIds: ['docx-read'],
  inputSchema: docxSearchRequestSchema,
  outputSchema: docxSearchOutputSchema,
  promptSpec: {
    name: 'docx_search',
    description:
      '能力：在 sourcePath 对应 docx 中按 literal、regex 或 semantic 模式检索块级文本。\n结果：返回匹配块的文本、匹配位置和相关性信息。\n边界：semantic 检索依赖 embedding runtime；返回命中数量受上限限制。',
    whenToUse: '适用于需要检索 docx 块级文本内容的任务。',
    examples: [
      {
        goal: '按原词做 literal 搜索，先定位“反走样”在哪些 block',
        args: DOCX_SEARCH_LITERAL_EXAMPLE
      },
      {
        goal: '用 regex 搜索术语形态不稳定的表达',
        args: DOCX_SEARCH_REGEX_EXAMPLE
      },
      {
        goal: '当用户只记得概念、不记得原词时，使用 semantic 召回相关段落',
        args: DOCX_SEARCH_SEMANTIC_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_search'
} satisfies DocxToolSpec<
  z.infer<typeof docxSearchRequestSchema>,
  z.infer<typeof docxSearchOutputSchema>,
  'docx_search',
  'docx-read'
>

export const DOCX_READ_TOOL_SPEC = {
  name: 'docx_read_blocks',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 blockIndex 区间或 blockIds 精读 docx 内容。',
  skillIds: ['docx-read'],
  inputSchema: docxReadRequestSchema,
  outputSchema: docxReadBlocksOutputSchema,
  promptSpec: {
    name: 'docx_read_blocks',
    description:
      '能力：按 blockId 集合或 blockIndex 闭区间读取 sourcePath 对应 docx 的详细块内容。\n结果：返回块内更细的内容结构，包括段落 runs、表格单元格和单元格段落信息。\n边界：读取指定块的详细结构，不改变 docx 内容。',
    whenToUse: '适用于需要 docx 指定块详细内容的任务。',
    examples: [
      {
        goal: '连续精读“反走样”一节对应的 block 区间',
        args: DOCX_READ_RANGE_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_blocks'
} satisfies DocxToolSpec<
  z.infer<typeof docxReadRequestSchema>,
  z.infer<typeof docxReadBlocksOutputSchema>,
  'docx_read_blocks',
  'docx-read'
>

export const DOCX_HISTORY_TOOL_SPEC = {
  name: 'docx_history',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '查看当前任务过程中的 docx 修订历史。',
  skillIds: ['docx-read'],
  inputSchema: docxHistoryRequestSchema,
  outputSchema: docxHistoryOutputSchema,
  promptSpec: {
    name: 'docx_history',
    description:
      '能力：读取 sourcePath 对应 docx 在当前任务内的编辑 revision 历史。\n结果：返回当前任务内的修订链、修订摘要和变更块信息。\n边界：历史来自当前任务的 docx 编辑链路，不是 Word 原生修订记录。',
    whenToUse: '适用于需要 docx 编辑 revision 历史的任务。',
    examples: [
      {
        goal: '查看最近几个 docx 修订及各自改动摘要',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          limit: 5
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_history'
} satisfies DocxToolSpec<
  z.infer<typeof docxHistoryRequestSchema>,
  z.infer<typeof docxHistoryOutputSchema>,
  'docx_history',
  'docx-read'
>

export const DOCX_PARAGRAPH_EDIT_TOOL_SPEC = {
  name: 'docx_paragraph_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按段落对象执行插入。',
  skillIds: ['docx-write'],
  inputSchema: docxParagraphEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_paragraph_edit',
    description:
      '能力：以 anchorBlockId 为锚点，在其前后插入一个或多个段落块。\n结果：返回写入后的编辑状态，以及相邻区域的详细回读信息。\n边界：只创建新的段落块，不替换已有文本内容。',
    whenToUse: '适用于需要插入 docx 段落块的任务。',
    examples: [
      {
        goal: '在目标段落后插入一段说明',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          action: 'insert_after',
          anchorBlockId: 'b:26',
          paragraphs: ['补充说明：反走样通过平滑边缘像素来减轻锯齿感。']
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_paragraph_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxParagraphEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_paragraph_edit',
  'docx-write'
>

export const DOCX_CREATE_TOOL_SPEC = {
  name: 'docx_create',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '创建一份新的 docx 草稿目标，供后续继续读取、编辑和审阅。',
  skillIds: ['docx-write'],
  inputSchema: docxCreateSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_create',
    description:
      '能力：创建一份新的 docx 文件内容，并纳入当前任务的 docx 编辑链路。\n结果：返回创建后的编辑状态和写后回读信息。\n边界：不会覆盖已有文件；创建后先作为待审阅内容存在，commit 前不会写入最终路径。',
    whenToUse: '适用于需要新建 docx 文件内容的任务。',
    examples: [
      {
        goal: '先创建一份给同学复习用的总结文档',
        args: DOCX_CREATE_EXAMPLE_ARGS
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_create'
} satisfies DocxToolSpec<
  z.infer<typeof docxCreateSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_create',
  'docx-write'
>

export const DOCX_HEADING_EDIT_TOOL_SPEC = {
  name: 'docx_heading_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按标题对象执行插入。',
  skillIds: ['docx-write'],
  inputSchema: docxHeadingEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_heading_edit',
    description:
      '能力：以 anchorBlockId 为锚点，在其前后插入一个或多个指定层级的标题块。\n结果：返回写入后的编辑状态，以及相邻区域的详细回读信息。\n边界：标题以段落样式写入；不替换已有标题文字。',
    whenToUse: '适用于需要插入 docx 标题块的任务。',
    examples: [
      {
        goal: '在指定 block 后插入一个二级标题',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          action: 'insert_after',
          anchorBlockId: 'b:26',
          headings: [{ level: 2, text: '反走样与过拟合对照' }]
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_heading_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxHeadingEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_heading_edit',
  'docx-write'
>

export const DOCX_TABLE_EDIT_TOOL_SPEC = {
  name: 'docx_table_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按表格对象执行插入或改单元格。',
  skillIds: ['docx-write'],
  inputSchema: docxTableEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_table_edit',
    description:
      '能力：以 anchorBlockId 为锚点插入表格，或通过 cellBlockId 更新表格单元格文本。\n结果：返回写入后的编辑状态，以及相邻区域的详细回读信息。\n边界：插入表格使用二维文本 rows；更新单元格会把目标单元格内容替换为单段文本。',
    whenToUse: '适用于需要插入 docx 表格或更新表格单元格文本的任务。',
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
} satisfies DocxToolSpec<
  z.infer<typeof docxTableEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_table_edit',
  'docx-write'
>

export const DOCX_TEXT_EDIT_TOOL_SPEC = {
  name: 'docx_text_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 query 执行文本查找替换。',
  skillIds: ['docx-write'],
  inputSchema: docxTextEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_text_edit',
    description:
      '能力：在 sourcePath 对应 docx 中按 query 执行文本查找替换，可用 blockIds 限定范围。\n结果：返回写入后的编辑状态，以及命中区域的详细回读信息。\n边界：执行文本级替换，不创建新的段落、标题或表格结构。',
    whenToUse: '适用于需要替换 docx 现有文本内容的任务。',
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
} satisfies DocxToolSpec<
  z.infer<typeof docxTextEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_text_edit',
  'docx-write'
>

export const DOCX_TEXT_STYLE_EDIT_TOOL_SPEC = {
  name: 'docx_text_style_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '在指定块内按 query 命中文本并应用样式。',
  skillIds: ['docx-write'],
  inputSchema: docxTextStyleEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_text_style_edit',
    description:
      '能力：在指定 blockId 内按 query 命中文本并应用 color、bold、italic 或 underline 样式。\n结果：返回写入后的编辑状态，以及命中区域的详细回读信息。\n边界：只修改命中文本的样式，不改变文本内容。',
    whenToUse: '适用于需要修改 docx 现有文本样式的任务。',
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
  z.infer<typeof docxWriteOutputSchema>,
  'docx_text_style_edit',
  'docx-write'
>

export const DOCX_DELETE_TOOL_SPEC = {
  name: 'docx_delete',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '删除一个或多个完整 docx block。',
  skillIds: ['docx-write'],
  inputSchema: docxDeleteSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_delete',
    description:
      '能力：按 blockIds 删除一个或多个完整 docx block。\n结果：返回写入后的编辑状态，以及删除位置相邻区域的详细回读信息。\n边界：删除粒度是完整 block，不执行 run 级或文本片段级删除。',
    whenToUse: '适用于需要删除 docx 完整块的任务。',
    examples: [
      {
        goal: '删除两个完整段落',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          blockIds: ['b:12', 'b:13']
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_delete'
} satisfies DocxToolSpec<
  z.infer<typeof docxDeleteSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_delete',
  'docx-write'
>

export const DOCX_ROLLBACK_TOOL_SPEC = {
  name: 'docx_rollback',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按修订号回退当前 docx 草稿。',
  skillIds: ['docx-write'],
  inputSchema: docxRollbackRequestSchema,
  outputSchema: docxRollbackOutputSchema,
  promptSpec: {
    name: 'docx_rollback',
    description:
      '能力：按 revisionRef 切回 sourcePath 对应 docx 的当前编辑 revision。\n结果：返回回退后的编辑状态。\n边界：只切换当前任务内的编辑状态，不直接覆盖源文件。',
    whenToUse: '适用于需要切换 docx 编辑 revision 状态的任务。',
    examples: [
      {
        goal: '把当前草稿回退到指定修订',
        args: {
          sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
          revisionRef: 'v2'
        }
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_rollback'
} satisfies DocxToolSpec<
  z.infer<typeof docxRollbackRequestSchema>,
  z.infer<typeof docxRollbackOutputSchema>,
  'docx_rollback',
  'docx-write'
>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC,
  DOCX_HISTORY_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [
  DOCX_CREATE_TOOL_SPEC,
  DOCX_PARAGRAPH_EDIT_TOOL_SPEC,
  DOCX_HEADING_EDIT_TOOL_SPEC,
  DOCX_TABLE_EDIT_TOOL_SPEC,
  DOCX_TEXT_EDIT_TOOL_SPEC,
  DOCX_TEXT_STYLE_EDIT_TOOL_SPEC,
  DOCX_DELETE_TOOL_SPEC,
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
