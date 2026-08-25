import { z } from 'zod/v4'
import type { DocxCreateTableCellNode } from './nodeTypes'

export const docxHexColorSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{6}$/, 'color must be exactly 6 hexadecimal characters, for example FF0000')

export const runSpecSchema = z.object({
  text: z.string(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  color: docxHexColorSchema.optional()
})

export const paragraphSpecSchema = z.object({
  kind: z.literal('paragraph'),
  style: z.string().optional(),
  runs: z.array(runSpecSchema).min(1)
})

export const tableCellSpecSchema = z.object({
  paragraphs: z.array(paragraphSpecSchema).min(1)
})

export const tableSpecSchema = z.object({
  kind: z.literal('table'),
  rows: z.array(z.array(tableCellSpecSchema).min(1)).min(1)
})

export const blockSpecSchema = z.union([paragraphSpecSchema, tableSpecSchema])
export const docxSearchModeSchema = z.enum(['literal', 'regex', 'semantic'])

const nullable = <T extends z.ZodType>(schema: T) => schema.nullable().optional()
const docxPointSchema = z.number().min(0)
const docxLengthSchema = z
  .object({
    value: z.number().positive(),
    unit: z.enum(['pt', 'percent'])
  })
  .strict()
const docxBorderSchema = z
  .object({
    style: z.enum(['none', 'single', 'dashed', 'dotted', 'double']),
    color: docxHexColorSchema.optional(),
    size: z.number().positive().optional()
  })
  .strict()
const docxBordersSchema = z
  .object({
    top: docxBorderSchema.optional(),
    right: docxBorderSchema.optional(),
    bottom: docxBorderSchema.optional(),
    left: docxBorderSchema.optional(),
    insideHorizontal: docxBorderSchema.optional(),
    insideVertical: docxBorderSchema.optional()
  })
  .strict()

export const docxRunStyleSchema = z
  .object({
    color: docxHexColorSchema.optional().describe('文字颜色，6 位十六进制，如 FF0000'),
    bold: z.boolean().optional().describe('是否加粗'),
    italic: z.boolean().optional().describe('是否斜体'),
    underline: z.boolean().optional().describe('是否下划线'),
    strike: z.boolean().optional().describe('是否删除线'),
    highlight: docxHexColorSchema.optional().describe('文字高亮底色，6 位十六进制'),
    fontFamily: z.string().trim().min(1).optional().describe('字体名称，如 宋体、Times New Roman'),
    fontSize: z.number().positive().optional().describe('字号，单位磅')
  })
  .strict()
  .meta({ id: 'DocxRunStyle' })

export const docxParagraphStyleSchema = z
  .object({
    styleName: z.string().trim().min(1).optional().describe('段落样式名称，如 Heading 1、标题 1'),
    alignment: z
      .enum(['left', 'center', 'right', 'justify'])
      .optional()
      .describe('水平对齐：left/center/right/justify'),
    indent: z
      .object({
        left: docxPointSchema.optional().describe('左缩进，单位磅'),
        right: docxPointSchema.optional().describe('右缩进，单位磅'),
        firstLine: docxPointSchema.optional().describe('首行缩进，单位磅'),
        hanging: docxPointSchema.optional().describe('悬挂缩进，单位磅')
      })
      .strict()
      .optional(),
    spacing: z
      .object({
        before: docxPointSchema.optional().describe('段前间距，单位磅'),
        after: docxPointSchema.optional().describe('段后间距，单位磅'),
        line: z.number().positive().optional().describe('行距，单位磅')
      })
      .strict()
      .optional(),
    keepWithNext: z.boolean().optional().describe('是否与下一段保持同页'),
    pageBreakBefore: z.boolean().optional().describe('段前是否分页')
  })
  .strict()
  .meta({ id: 'DocxParagraphStyle' })

export const docxTableStyleSchema = z
  .object({
    alignment: z.enum(['left', 'center', 'right']).optional().describe('表格水平对齐'),
    width: docxLengthSchema.optional().describe('表格宽度，{ value, unit: "pt" | "percent" }'),
    layout: z.enum(['fixed', 'autofit']).optional().describe('表格布局：fixed 固定 / autofit 自动'),
    borders: docxBordersSchema.optional().describe('表格边框')
  })
  .strict()
  .meta({ id: 'DocxTableStyle' })

export const docxTableRowStyleSchema = z
  .object({
    height: docxPointSchema.optional().describe('行高，单位磅'),
    repeatHeader: z.boolean().optional().describe('是否作为表头在每页重复'),
    cantSplit: z.boolean().optional().describe('是否禁止跨页拆分')
  })
  .strict()
  .meta({ id: 'DocxTableRowStyle' })

export const docxTableCellStyleSchema = z
  .object({
    width: docxLengthSchema.optional().describe('单元格宽度，{ value, unit: "pt" | "percent" }'),
    verticalAlignment: z
      .enum(['top', 'center', 'bottom'])
      .optional()
      .describe('单元格垂直对齐'),
    shading: docxHexColorSchema.optional().describe('单元格底纹颜色，6 位十六进制'),
    margins: z
      .object({
        top: docxPointSchema.optional().describe('上边距，单位磅'),
        right: docxPointSchema.optional().describe('右边距，单位磅'),
        bottom: docxPointSchema.optional().describe('下边距，单位磅'),
        left: docxPointSchema.optional().describe('左边距，单位磅')
      })
      .strict()
      .optional(),
    borders: docxBordersSchema.optional().describe('单元格边框')
  })
  .strict()
  .meta({ id: 'DocxTableCellStyle' })

const docxCreateTextNodeSchema = z
  .object({ type: z.literal('text'), text: z.string() })
  .strict()
  .meta({ id: 'DocxCreateText' })
const docxCreateTabNodeSchema = z
  .object({ type: z.literal('tab') })
  .strict()
  .meta({ id: 'DocxCreateTab' })
const docxCreateBreakNodeSchema = z
  .object({ type: z.literal('break'), kind: z.enum(['line', 'page', 'column']).optional() })
  .strict()
  .meta({ id: 'DocxCreateBreak' })
const docxCreateRunNodeSchema = z
  .object({
    type: z.literal('run'),
    style: docxRunStyleSchema.optional(),
    children: z
      .array(
        z.discriminatedUnion('type', [
          docxCreateTextNodeSchema,
          docxCreateTabNodeSchema,
          docxCreateBreakNodeSchema
        ])
      )
      .min(1)
  })
  .strict()
  .meta({ id: 'DocxCreateRun' })
const docxCreateHyperlinkNodeSchema = z
  .object({
    type: z.literal('hyperlink'),
    target: z.string().trim().min(1).optional(),
    anchor: z.string().trim().min(1).optional(),
    children: z.array(docxCreateRunNodeSchema).min(1)
  })
  .strict()
  .refine((value) => Boolean(value.target || value.anchor), {
    message: 'hyperlink requires target or anchor'
  })
  .meta({
    id: 'DocxCreateHyperlink',
    'x-constraint': 'hyperlink requires target or anchor'
  })
const docxCreateParagraphNodeSchema = z
  .object({
    type: z.literal('paragraph'),
    style: docxParagraphStyleSchema.optional(),
    children: z
      .array(z.discriminatedUnion('type', [docxCreateRunNodeSchema, docxCreateHyperlinkNodeSchema]))
      .min(1)
  })
  .strict()
  .meta({ id: 'DocxCreateParagraph' })
const docxCreateTableCellNodeSchema: z.ZodType<DocxCreateTableCellNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('table_cell'),
      style: docxTableCellStyleSchema.optional(),
      children: z.array(docxCreateBlockSchema).min(1)
    })
    .strict()
    .meta({ id: 'DocxCreateTableCell' })
)
const docxCreateTableRowNodeSchema = z
  .object({
    type: z.literal('table_row'),
    style: docxTableRowStyleSchema.optional(),
    children: z.array(docxCreateTableCellNodeSchema).min(1)
  })
  .strict()
  .meta({ id: 'DocxCreateTableRow' })
const docxCreateTableNodeSchema = z
  .object({
    type: z.literal('table'),
    style: docxTableStyleSchema.optional(),
    children: z.array(docxCreateTableRowNodeSchema).min(1)
  })
  .strict()
  .meta({ id: 'DocxCreateTable' })

export const docxCreateBlockSchema = z
  .discriminatedUnion('type', [docxCreateParagraphNodeSchema, docxCreateTableNodeSchema])
  .meta({ id: 'DocxCreateBlock' })

const runStylePatchSchema = z
  .object({
    kind: z.literal('run'),
    color: nullable(docxHexColorSchema),
    bold: nullable(z.boolean()),
    italic: nullable(z.boolean()),
    underline: nullable(z.boolean()),
    strike: nullable(z.boolean()),
    highlight: nullable(docxHexColorSchema),
    fontFamily: nullable(z.string().trim().min(1)),
    fontSize: nullable(z.number().positive())
  })
  .strict()
const paragraphStylePatchSchema = docxParagraphStyleSchema
  .partial()
  .extend({
    kind: z.literal('paragraph'),
    styleName: nullable(z.string().trim().min(1)),
    alignment: nullable(z.enum(['left', 'center', 'right', 'justify'])),
    indent: nullable(docxParagraphStyleSchema.shape.indent.unwrap()),
    spacing: nullable(docxParagraphStyleSchema.shape.spacing.unwrap()),
    keepWithNext: nullable(z.boolean()),
    pageBreakBefore: nullable(z.boolean())
  })
  .strict()
const tableStylePatchSchema = z
  .object({
    kind: z.literal('table'),
    alignment: nullable(z.enum(['left', 'center', 'right'])),
    width: nullable(docxLengthSchema),
    layout: nullable(z.enum(['fixed', 'autofit'])),
    borders: nullable(docxBordersSchema)
  })
  .strict()
const tableRowStylePatchSchema = z
  .object({
    kind: z.literal('table_row'),
    height: nullable(docxPointSchema),
    repeatHeader: nullable(z.boolean()),
    cantSplit: nullable(z.boolean())
  })
  .strict()
const tableCellStylePatchSchema = z
  .object({
    kind: z.literal('table_cell'),
    width: nullable(docxLengthSchema),
    verticalAlignment: nullable(z.enum(['top', 'center', 'bottom'])),
    shading: nullable(docxHexColorSchema),
    margins: nullable(docxTableCellStyleSchema.shape.margins.unwrap()),
    borders: nullable(docxBordersSchema)
  })
  .strict()

export const docxStylePatchSchema = z
  .discriminatedUnion('kind', [
    runStylePatchSchema,
    paragraphStylePatchSchema,
    tableStylePatchSchema,
    tableRowStylePatchSchema,
    tableCellStylePatchSchema
  ])
  .refine((patch) => Object.keys(patch).some((key) => key !== 'kind'), {
    message: 'style patch must contain at least one property'
  })
  .meta({ id: 'DocxStylePatch', 'x-constraint': 'style patch must contain at least one property' })

export const docxStyleTargetSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        type: z.literal('text_match'),
        query: z.string().min(1).describe('要匹配的文字，命中后应用样式'),
        blockIds: z
          .array(z.string().min(1))
          .optional()
          .describe('限定在哪些 block 内查找，缺省为全文')
      })
      .strict(),
    z
      .object({
        type: z.literal('id'),
        id: z
          .string()
          .min(1)
          .describe(
            'read 返回的目标元素 id：正文段落/表格/单元格填 blockId，行/单元格内段落/具体 run 填 nodeId，直接照抄'
          )
      })
      .strict()
  ])
  .meta({ id: 'DocxStyleTarget' })

export const docOpSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('create_document')
  }),
  z.object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1),
    content: docxCreateBlockSchema,
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('insert_after'),
    anchorBlockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1)
  }),
  z.object({
    type: z.literal('insert_before'),
    anchorBlockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1)
  }),
  z.object({
    type: z.literal('delete_block'),
    blockId: z.string().min(1),
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('update_table_cell'),
    blockId: z.string().min(1),
    content: z.array(docxCreateBlockSchema).min(1),
    allowVisualLoss: z.literal(true).optional()
  }),
  z.object({
    type: z.literal('replace_text'),
    query: z.string().min(1),
    replace: z.string(),
    blockIds: z.array(z.string().min(1)).optional()
  }),
  z.object({
    type: z.literal('style'),
    target: docxStyleTargetSchema,
    patch: docxStylePatchSchema
  })
])

export const docxOutlineRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('percent'),
      fromPercent: z.number().min(0).max(100),
      toPercent: z.number().min(0).max(100)
    })
    .strict(),
  z
    .object({
      type: z.literal('block_index'),
      fromBlockIndex: z.number().int().min(0),
      toBlockIndex: z.number().int().min(0)
    })
    .strict()
])

export const docxOutlineRequestSchema = z
  .object({
    sourcePath: z.string().min(1),
    ranges: z.array(docxOutlineRangeSchema).min(1)
  })
  .strict()

export const docxSearchRequestSchema = z.object({
  sourcePath: z.string().min(1),
  query: z.string().min(1),
  mode: docxSearchModeSchema.optional(),
  scope: z
    .object({
      blockIds: z.array(z.string().min(1)).optional()
    })
    .optional()
})

export const docxReadRangeSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('block_index'),
      fromBlockIndex: z.number().int().min(0),
      toBlockIndex: z.number().int().min(0)
    })
    .strict(),
  z
    .object({
      type: z.literal('block_ids'),
      blockIds: z.array(z.string().min(1)).min(1)
    })
    .strict()
])

export const docxReadRequestSchema = z
  .object({
    sourcePath: z.string().min(1),
    range: docxReadRangeSchema
  })
  .strict()

const docxParagraphInputSchema = z
  .object({
    text: z.string().describe('段落纯文本，换行用 \\n，制表符用 \\t'),
    style: docxParagraphStyleSchema
      .optional()
      .describe('段落级样式（对齐/缩进/间距/样式名），可选')
  })
  .strict()

const docxTableInputSchema = z
  .object({
    rows: z
      .array(z.array(z.string()).min(1))
      .min(1)
      .describe('二维数组，每个单元格是纯文本字符串'),
    style: docxTableStyleSchema.optional().describe('表格级样式（对齐/宽度/布局/边框），可选')
  })
  .strict()

export const docxBlockInputSchema = z.union([docxParagraphInputSchema, docxTableInputSchema])

const docxRunStyleInputSchema = docxRunStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'style 至少设置一个属性' }
)
const docxParagraphStyleInputSchema = docxParagraphStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'style 至少设置一个属性' }
)
const docxTableStyleInputSchema = docxTableStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'style 至少设置一个属性' }
)
const docxRowStyleInputSchema = docxTableRowStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'style 至少设置一个属性' }
)
const docxCellStyleInputSchema = docxTableCellStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'style 至少设置一个属性' }
)

const docxEditInsertBlocksActionSchema = z
  .object({
    type: z.literal('insert_blocks'),
    blockId: z
      .string()
      .min(1)
      .optional()
      .describe('锚点 blockId，缺省表示追加到正文末尾'),
    position: z.enum(['before', 'after']).optional().describe('相对锚点的位置，缺省 after'),
    blocks: z.array(docxBlockInputSchema).min(1).describe('要插入的段落或表格')
  })
  .strict()

const docxEditReplaceBlockActionSchema = z
  .object({
    type: z.literal('replace_block'),
    blockId: z.string().min(1).describe('read 返回的目标 blockId'),
    block: docxBlockInputSchema.describe('替换后的段落或表格内容'),
    allowVisualLoss: z
      .literal(true)
      .optional()
      .describe('目标含图片/图表等视觉内容时必须显式设为 true 才允许替换')
  })
  .strict()

const docxEditReplaceTextActionSchema = z
  .object({
    type: z.literal('replace_text'),
    query: z.string().min(1).describe('要查找的原文'),
    replace: z.string().describe('替换后的文本'),
    blockIds: z
      .array(z.string().min(1))
      .optional()
      .describe('限定在哪些 block 内替换，缺省为全文')
  })
  .strict()

const docxEditDeleteBlocksActionSchema = z
  .object({
    type: z.literal('delete_blocks'),
    blockIds: z.array(z.string().min(1)).min(1).describe('要删除的 blockId 列表'),
    allowVisualLoss: z
      .literal(true)
      .optional()
      .describe('目标含视觉内容时必须显式设为 true 才允许删除')
  })
  .strict()

const docxEditUpdateTableCellActionSchema = z
  .object({
    type: z.literal('update_table_cell'),
    cellBlockId: z.string().min(1).describe('read 返回的单元格 blockId'),
    blocks: z
      .array(docxBlockInputSchema)
      .min(1)
      .describe('单元格的新内容（多段落或嵌套表格）'),
    allowVisualLoss: z
      .literal(true)
      .optional()
      .describe('单元格含视觉内容时必须显式设为 true 才允许更新')
  })
  .strict()

const docxEditStyleTextActionSchema = z
  .object({
    type: z.literal('style_text'),
    query: z.string().min(1).describe('要套用文字样式的目标文字'),
    blockIds: z
      .array(z.string().min(1))
      .optional()
      .describe('限定在哪些 block 内查找，缺省为全文'),
    style: docxRunStyleInputSchema.describe('文字样式（加粗/颜色/字号等）')
  })
  .strict()

const docxEditStyleParagraphActionSchema = z
  .object({
    type: z.literal('style_paragraph'),
    id: z
      .string()
      .min(1)
      .describe('read 返回的段落 id：正文段落填 blockId，单元格内段落填 nodeId'),
    style: docxParagraphStyleInputSchema.describe('段落样式（对齐/缩进/间距等）')
  })
  .strict()

const docxEditStyleTableActionSchema = z
  .object({
    type: z.literal('style_table'),
    id: z.string().min(1).describe('read 返回的表格 blockId'),
    style: docxTableStyleInputSchema.describe('表格样式（边框/宽度/布局等）')
  })
  .strict()

const docxEditStyleRowActionSchema = z
  .object({
    type: z.literal('style_row'),
    id: z.string().min(1).describe('read 返回的行 nodeId'),
    style: docxRowStyleInputSchema.describe('行样式（行高/表头重复/禁止跨页）')
  })
  .strict()

const docxEditStyleCellActionSchema = z
  .object({
    type: z.literal('style_cell'),
    id: z.string().min(1).describe('read 返回的单元格 blockId'),
    style: docxCellStyleInputSchema.describe('单元格样式（底纹/边框/边距/垂直对齐等）')
  })
  .strict()

export const docxEditActionSchema = z
  .discriminatedUnion('type', [
    docxEditInsertBlocksActionSchema,
    docxEditReplaceBlockActionSchema,
    docxEditReplaceTextActionSchema,
    docxEditDeleteBlocksActionSchema,
    docxEditUpdateTableCellActionSchema,
    docxEditStyleTextActionSchema,
    docxEditStyleParagraphActionSchema,
    docxEditStyleTableActionSchema,
    docxEditStyleRowActionSchema,
    docxEditStyleCellActionSchema
  ])
  .meta({ id: 'DocxEditAction' })

export const docxEditSchema = z
  .object({
    sourcePath: z.string().min(1).describe('DOCX 文件的本机绝对路径，文件不存在时按新建处理'),
    actions: z.array(docxEditActionSchema).min(1).describe('按顺序串行执行的编辑动作')
  })
  .strict()

export const docxReadVisualsSchema = z
  .object({
    sourcePath: z.string().min(1),
    requests: z
      .array(
        z
          .object({
            visualId: z.string().min(1),
            instruction: z.string().trim().min(1)
          })
          .strict()
      )
      .min(1)
      .max(10)
  })
  .strict()
