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
  schema: docxOutlineRequestSchema,
  promptSpec: {
    name: 'docx_outline',
    description: '按 percent 或 blockIndex 范围读取 docx 轻量文本地图，拿到 blockId、blockIndex 和文本预览。',
    whenToUse: '当你需要先理解文档局部结构、定位标题或表格、或为后续精读/编辑拿到 blockId/blockIndex 时使用。',
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
} satisfies DocxToolSpec<z.infer<typeof docxOutlineRequestSchema>, 'docx_outline', 'docx-read'>

export const DOCX_SEARCH_TOOL_SPEC = {
  name: 'docx_search',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '在 docx 中定位相关内容，支持 literal / regex / semantic 三种模式。',
  skillIds: ['docx-read'],
  schema: docxSearchRequestSchema,
  promptSpec: {
    name: 'docx_search',
    description: '先定位相关 block，再决定是否继续精读。',
    whenToUse:
      '当你需要查找术语、换词重试、切换 regex / semantic 检索模式，或拿到 blockId 供后续 docx_read_blocks 精读时使用。',
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
} satisfies DocxToolSpec<z.infer<typeof docxSearchRequestSchema>, 'docx_search', 'docx-read'>

export const DOCX_READ_TOOL_SPEC = {
  name: 'docx_read_blocks',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按 blockIndex 区间或 blockIds 精读 docx 内容。',
  skillIds: ['docx-read'],
  schema: docxReadRequestSchema,
  promptSpec: {
    name: 'docx_read_blocks',
    description: '读取一个或多个 block，或按 blockIndex 区间连续精读一段内容。',
    whenToUse:
      '当你已经通过 docx_search 或 docx_outline 拿到 blockId，准备精读一个 block 或一段连续区间时使用。',
    examples: [
      {
        goal: '连续精读“反走样”一节对应的 block 区间',
        args: DOCX_READ_RANGE_EXAMPLE
      }
    ]
  },
  resolveExecutionMeta: createDocxReadExecutionMeta(),
  activityActionType: 'docx_read_blocks'
} satisfies DocxToolSpec<z.infer<typeof docxReadRequestSchema>, 'docx_read_blocks', 'docx-read'>

export const DOCX_HISTORY_TOOL_SPEC = {
  name: 'docx_history',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '查看当前任务过程中的 docx 修订历史。',
  skillIds: ['docx-read'],
  schema: docxHistoryRequestSchema,
  promptSpec: {
    name: 'docx_history',
    description: '查看当前任务过程中这份 docx 的修订链、修订摘要和变更块。',
    whenToUse: '当你要确认编辑历史、比较最近几次修订差异、或决定回滚到哪个修订时使用。',
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
} satisfies DocxToolSpec<z.infer<typeof docxHistoryRequestSchema>, 'docx_history', 'docx-read'>

export const DOCX_PARAGRAPH_EDIT_TOOL_SPEC = {
  name: 'docx_paragraph_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按段落对象执行插入。',
  skillIds: ['docx-write'],
  schema: docxParagraphEditSchema,
  promptSpec: {
    name: 'docx_paragraph_edit',
    description: '按段落对象插入一个或多个段落。',
    whenToUse:
      '当你已经明确段落锚点，且只需要插入段落时使用。替换文字用 docx_text_edit，删除完整 block 用 docx_delete。若命中复杂定位排版区域，任何自动编辑都会失败，此时不要重复尝试 docx 写操作。',
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
  'docx_paragraph_edit',
  'docx-write'
>

export const DOCX_CREATE_TOOL_SPEC = {
  name: 'docx_create',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '创建一份新的 docx 草稿目标，供后续继续读取、编辑和审阅。',
  skillIds: ['docx-write'],
  schema: docxCreateSchema,
  promptSpec: {
    name: 'docx_create',
    description: '先创建一份新的 docx 草稿目标，再继续写入或编辑它。',
    whenToUse:
      '当用户明确要你生成一份新的 Word 文件，或者当前 workspace 里还没有目标 docx 时使用。创建成功后可继续对同一路径执行 docx_outline、docx_read_blocks 和 docx_*_edit。',
    examples: [
      {
        goal: '先创建一份给同学复习用的总结文档',
        args: DOCX_CREATE_EXAMPLE_ARGS
      }
    ]
  },
  resolveExecutionMeta: createDocxMutatingExecutionMeta(),
  activityActionType: 'docx_create'
} satisfies DocxToolSpec<z.infer<typeof docxCreateSchema>, 'docx_create', 'docx-write'>

export const DOCX_HEADING_EDIT_TOOL_SPEC = {
  name: 'docx_heading_edit',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按标题对象执行插入。',
  skillIds: ['docx-write'],
  schema: docxHeadingEditSchema,
  promptSpec: {
    name: 'docx_heading_edit',
    description: '按标题对象插入一个或多个标题。',
    whenToUse:
      '当你要在某处插入标题时使用。替换标题文字用 docx_text_edit。若命中复杂定位排版区域，任何自动编辑都会失败，此时应改为说明限制并给用户手动操作建议。',
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
    description: '按表格对象插入表格或更新单元格内容。',
    whenToUse:
      '当你需要插入一个简单二维文本表格，或更新某个 table cell 的内容时使用。若命中复杂定位排版区域，任何自动编辑都会失败，此时不要重复尝试 docx 写操作。',
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
    description: '在当前 docx 中按 query 查找并替换文本，可选 blockIds 缩小范围。',
    whenToUse:
      '当你想在一批命中文本里直接替换术语或改写短句时使用。它适合 normal 正文流里的原地改字，不适合新增结构；若命中复杂定位排版区域，也会直接失败。',
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
    description: '给现有文本片段加颜色、粗体、斜体或下划线，不改文字本身。',
    whenToUse:
      '当你需要把某一段已有文本标红、加粗或下划线时使用。它适合 normal 正文流里的原地样式调整，不适合新增结构；若命中复杂定位排版区域，也会直接失败。',
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

export const DOCX_DELETE_TOOL_SPEC = {
  name: 'docx_delete',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '删除一个或多个完整 docx block。',
  skillIds: ['docx-write'],
  schema: docxDeleteSchema,
  promptSpec: {
    name: 'docx_delete',
    description: '按 blockId 删除完整段落或表格 block，不支持 run 级删除。',
    whenToUse:
      '当你已经明确要删除的完整 blockId 时使用。只删除文本片段时使用 docx_text_edit 并将 replace 设为空字符串。',
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
} satisfies DocxToolSpec<z.infer<typeof docxDeleteSchema>, 'docx_delete', 'docx-write'>

export const DOCX_ROLLBACK_TOOL_SPEC = {
  name: 'docx_rollback',
  familyId: 'docx',
  requiresWorkspace: true,
  description: '按修订号回退当前 docx 草稿。',
  skillIds: ['docx-write'],
  schema: docxRollbackRequestSchema,
  promptSpec: {
    name: 'docx_rollback',
    description: '把当前任务过程中的 docx 草稿切回指定 revisionRef，不覆盖原文件。',
    whenToUse: '当你已经通过 docx_history 确认要回退到哪个修订时使用。',
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
} satisfies DocxToolSpec<z.infer<typeof docxRollbackRequestSchema>, 'docx_rollback', 'docx-write'>

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
