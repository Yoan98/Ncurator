import type { JsonObject } from '../../../../../../shared/types'
import type { z } from 'zod/v4'
import type { RuntimeSkillId } from '../../types'
import type { HumanToolSpec } from '../types'
import {
  docxEditSchema,
  docxOutlineRequestSchema,
  docxReadRequestSchema,
  docxSearchRequestSchema
} from './schemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import {
  docxOutlineOutputSchema,
  docxReadBlocksOutputSchema,
  docxSearchOutputSchema,
  docxWriteOutputSchema
} from './outputSchemas'

const createDocxReadExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'read_only',
    getResourceKey: (args) => readStringArg(args, 'sourcePath'),
    defaultResourceKey: 'docx'
  })

const createDocxMutatingExecutionMeta = () =>
  createStaticExecutionMetaResolver({
    mutability: 'mutating',
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
const DOCX_EDIT_CREATE_DOCUMENT_EXAMPLE: JsonObject = {
  sourcePath: '深度学习与图形学复习总结.docx',
  actions: [
    {
      type: 'create_document',
      blocks: [
        {
          type: 'heading',
          level: 1,
          text: '深度学习与图形学复习总结'
        },
        {
          type: 'paragraph',
          text: '本总结整理关键概念、出现原因和常见处理方式。'
        }
      ]
    }
  ]
}
const DOCX_EDIT_INSERT_BLOCKS_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'insert_blocks',
      position: 'after',
      anchorBlockId: 'b:26',
      blocks: [
        {
          type: 'paragraph',
          text: '补充说明：反走样通过平滑边缘像素来减轻锯齿感。'
        },
        {
          type: 'table',
          rows: [
            ['概念', '说明'],
            ['反走样', '降低边缘锯齿']
          ]
        }
      ]
    }
  ]
}
const DOCX_EDIT_SERIAL_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'replace_block',
      blockId: 'b:12',
      block: {
        type: 'heading',
        level: 2,
        text: '反走样的常见处理方式'
      }
    },
    {
      type: 'insert_blocks',
      position: 'after',
      anchorBlockId: 'b:26',
      blocks: [{ type: 'paragraph', text: '补充说明：反走样可以降低边缘锯齿。' }]
    }
  ]
}
const DOCX_EDIT_REPLACE_BLOCK_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'replace_block',
      blockId: 'b:12',
      block: {
        type: 'heading',
        level: 2,
        text: '反走样的常见处理方式'
      }
    }
  ]
}
const DOCX_EDIT_REPLACE_TEXT_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'replace_text',
      blockIds: ['b:26'],
      query: '过拟合',
      replace: '模型过拟合'
    }
  ]
}
const DOCX_EDIT_STYLE_TEXT_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'style_text',
      blockId: 'b:26',
      query: '反走样',
      style: {
        bold: true,
        color: '2563EB'
      }
    }
  ]
}
const DOCX_EDIT_UPDATE_TABLE_CELL_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'update_table_cell',
      cellBlockId: 'tbl:3.r:2.c:1',
      text: '平滑边缘，降低锯齿'
    }
  ]
}
const DOCX_EDIT_DELETE_BLOCKS_EXAMPLE: JsonObject = {
  sourcePath: DOCX_SOURCE_PATH_EXAMPLE,
  actions: [
    {
      type: 'delete_blocks',
      blockIds: ['b:31', 'b:32']
    }
  ]
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

export const DOCX_EDIT_TOOL_SPEC = {
  name: 'docx_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '创建或修改 docx 内容，并返回写入后的相邻区域回读。',
  skillIds: ['docx-write'],
  inputSchema: docxEditSchema,
  outputSchema: docxWriteOutputSchema,
  promptSpec: {
    name: 'docx_edit',
    description: [
      '能力：创建或修改 docx 内容。一次 docx_edit 调用接收 actions 数组，并严格按数组顺序串行执行；全部 action 成功后才形成一次写入结果。',
      'action type=create_document：新建 docx，并可一次写入 heading、paragraph、table；必须作为唯一 action。',
      'action type=insert_blocks：在真实 anchorBlockId 前/后插入多个 block，按输入 blocks 顺序写入。',
      'action type=replace_block：把一个完整 block 替换成新的 heading、paragraph 或 table。',
      'action type=replace_text：在全文或指定 blockIds 中替换文本。',
      'action type=style_text：给指定 block 内命中的文本设置加粗、斜体、下划线、颜色等样式。',
      'action type=update_table_cell：替换指定表格单元格的文本。',
      'action type=delete_blocks：删除一个或多个完整 block。',
      '结果：返回写入后的编辑状态，以及所有 action 完成后的相邻区域详细回读信息（postWriteReadback字段），它代表着修改后最新的 docx 内容结构。',
      '边界：所有 blockId、anchorBlockId、cellBlockId、blockIds 必须来自 docx_outline、docx_search、docx_read_blocks 或 postWriteReadback 返回的真实结果，禁止推算新 blockId；禁止在同一次 actions 内引用本次刚创建、尚未回读的新 blockId。'
    ].join('\n'),
    whenToUse: '适用于需要创建或修改 docx 内容的任务。',
    examples: [
      {
        goal: '新建一份总结文档，并写入标题和正文段落',
        args: DOCX_EDIT_CREATE_DOCUMENT_EXAMPLE
      },
      {
        goal: '在指定 block 后按顺序插入多条内容',
        args: DOCX_EDIT_INSERT_BLOCKS_EXAMPLE
      },
      {
        goal: '按顺序连续完成多个修改',
        args: DOCX_EDIT_SERIAL_EXAMPLE
      },
      {
        goal: '把一个已读到的完整段落替换为标题',
        args: DOCX_EDIT_REPLACE_BLOCK_EXAMPLE
      },
      {
        goal: '在已读到的 block 内替换文本',
        args: DOCX_EDIT_REPLACE_TEXT_EXAMPLE
      },
      {
        goal: '给指定 block 内的关键词加粗并改色',
        args: DOCX_EDIT_STYLE_TEXT_EXAMPLE
      },
      {
        goal: '更新表格中的一个单元格',
        args: DOCX_EDIT_UPDATE_TABLE_CELL_EXAMPLE
      },
      {
        goal: '删除已确认多余的完整 block',
        args: DOCX_EDIT_DELETE_BLOCKS_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_edit'
} satisfies DocxToolSpec<
  z.infer<typeof docxEditSchema>,
  z.infer<typeof docxWriteOutputSchema>,
  'docx_edit',
  'docx-write'
>

export const DOCX_READ_TOOL_SPECS = [
  DOCX_OUTLINE_TOOL_SPEC,
  DOCX_SEARCH_TOOL_SPEC,
  DOCX_READ_TOOL_SPEC
] as const

export const DOCX_WRITE_TOOL_SPECS = [DOCX_EDIT_TOOL_SPEC] as const

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
