import { z } from 'zod/v4'
import type { DocxCreateTableCellNode } from './nodeTypes'
import {
  DOCX_FORMAT_MAX_TARGETS
} from './constants'

/** OOXML stores RRGGBB without `#`; leading `#` accepted as兜底 and stripped on write. */
const docxHexColorSchema = z
  .string()
  .trim()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'color must be 6 hexadecimal characters, for example FF0000')
  .describe('6 位十六进制，如 FF0000')
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

export const nodeSpecSchema = z.union([paragraphSpecSchema, tableSpecSchema])
export const docxSearchModeSchema = z.enum(['literal', 'regex'])

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
    size: z.number().positive().optional().describe('线宽，单位磅')
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
    highlight: docxHexColorSchema.optional().describe('文字高亮底色，6 位十六进制，如 FF0000'),
    fontFamily: z.string().trim().min(1).optional().describe('字体名称，如 宋体、Times New Roman'),
    fontSize: z.number().positive().optional().describe('字号，单位磅')
  })
  .strict()
  .meta({ id: 'DocxRunStyle' })

export const docxParagraphStyleSchema = z
  .object({
    styleId: z.string().trim().min(1).optional().describe('段落 styleId'),
    alignment: z.enum(['left', 'center', 'right', 'justify']).optional().describe('水平对齐'),
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
    layout: z.enum(['fixed', 'autofit']).optional().describe('表格布局'),
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
    verticalAlignment: z.enum(['top', 'center', 'bottom']).optional().describe('单元格垂直对齐'),
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
      children: z.array(docxCreateRootNodeSchema).min(1)
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

export const docxCreateRootNodeSchema = z
  .discriminatedUnion('type', [docxCreateParagraphNodeSchema, docxCreateTableNodeSchema])
  .meta({ id: 'DocxCreateRootNode' })

const docxReadSourcePathField = z
  .string()
  .min(1)
  .describe('Word 文件本机绝对路径；支持 .docx 与只读 .doc')

const docxWriteSourcePathField = z
  .string()
  .min(1)
  .describe('Word 文件本机绝对路径；仅 .docx')

const sourcePathField = docxReadSourcePathField
const nodeIdField = z.string().min(1).describe('节点 ID')
const searchScopeNodeIdField = z.string().min(1).describe('根节点或单元格 nodeId')

export const docxOutlineSchema = z
  .object({
    sourcePath: sourcePathField,
    fromPercent: z.number().min(0).max(100).describe('起始比例，0–100'),
    toPercent: z.number().min(0).max(100).describe('结束比例，0–100')
  })
  .strict()
  .refine((value) => value.toPercent >= value.fromPercent, {
    path: ['toPercent'],
    message: 'toPercent 必须大于或等于 fromPercent'
  })

export const docxSearchSchema = z
  .object({
    sourcePath: sourcePathField,
    query: z.string().min(1).describe('检索文字或正则'),
    mode: docxSearchModeSchema.optional().describe('literal 或 regex，缺省 literal'),
    nodeIds: z.array(searchScopeNodeIdField).min(1).optional().describe('可选搜索范围'),
    includeContext: z.boolean().optional().describe('是否返回命中前后预览')
  })
  .strict()

export const docxReadNodesSchema = z
  .object({
    sourcePath: sourcePathField,
    range: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('node_ids').describe('按 nodeId 读取'),
          nodeIds: z.array(nodeIdField).min(1).max(20).describe('1 至 20 个 nodeId')
        })
        .strict(),
      z
        .object({
          type: z.literal('node_index').describe('按 nodeIndex 连续读取'),
          fromNodeIndex: z.number().int().min(0).describe('起始 nodeIndex'),
          toNodeIndex: z.number().int().min(0).describe('结束 nodeIndex')
        })
        .strict()
    ])
  })
  .strict()
  .superRefine((value, context) => {
    if (value.range.type !== 'node_index') return
    if (value.range.toNodeIndex < value.range.fromNodeIndex) {
      context.addIssue({
        code: 'custom',
        path: ['range', 'toNodeIndex'],
        message: 'toNodeIndex 必须大于或等于 fromNodeIndex'
      })
      return
    }
    if (value.range.toNodeIndex - value.range.fromNodeIndex + 1 > 50) {
      context.addIssue({
        code: 'custom',
        path: ['range'],
        message: '单次最多读取 50 个根节点'
      })
    }
  })

const nonEmptyRunStyleSchema = docxRunStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'format 至少设置一个属性' }
)
const nonEmptyParagraphStyleSchema = docxParagraphStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'format 至少设置一个属性' }
)
const nonEmptyTableStyleSchema = docxTableStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'format 至少设置一个属性' }
)
const nonEmptyRowStyleSchema = docxTableRowStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'format 至少设置一个属性' }
)
const nonEmptyCellStyleSchema = docxTableCellStyleSchema.refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: 'format 至少设置一个属性' }
)

const docxParagraphDraftSchema = z
  .object({
    type: z.literal('paragraph').describe('段落节点'),
    text: z.string().describe('段落纯文本；换行用 \\n，制表符用 \\t'),
    style: docxParagraphStyleSchema.optional().describe('段落样式'),
    runStyle: docxRunStyleSchema.optional().describe('整段文字样式')
  })
  .strict()
const docxRunDraftSchema = z
  .object({
    type: z.literal('run').describe('文字 run 节点'),
    text: z.string().describe('run 的纯文本'),
    style: docxRunStyleSchema.optional().describe('该 run 的文字样式')
  })
  .strict()
const docxHyperlinkDraftSchema = z
  .object({
    type: z.literal('hyperlink').describe('超链接节点'),
    text: z.string().describe('链接显示文字'),
    target: z.string().trim().min(1).describe('链接 URL'),
    style: docxRunStyleSchema.optional().describe('链接显示文字的样式')
  })
  .strict()
const docxFieldDraftSchema = z
  .object({
    type: z.literal('field').describe('Word 字段节点'),
    instruction: z.string().trim().min(1).describe('字段指令，如 PAGE 或 TOC'),
    displayText: z.string().optional().describe('字段未更新前显示的文字')
  })
  .strict()
const docxBreakDraftSchema = z
  .object({
    type: z.literal('break').describe('换行、分页或分栏节点'),
    kind: z.enum(['line', 'page', 'column']).describe('break 类型')
  })
  .strict()
const docxVisualDraftSchema = z
  .object({
    type: z.literal('visual').describe('图片视觉节点'),
    imagePath: z.string().min(1).optional().describe('本机图片绝对路径；插入视觉节点时必填'),
    widthCm: z.number().positive().optional().describe('显示宽度，厘米'),
    heightCm: z.number().positive().optional().describe('显示高度，厘米'),
    altText: z.string().optional().describe('替代文字')
  })
  .strict()
  .refine(
    (value) =>
      value.imagePath !== undefined ||
      value.widthCm !== undefined ||
      value.heightCm !== undefined ||
      value.altText !== undefined,
    { message: 'visual 至少设置 imagePath、尺寸或 altText 之一' }
  )

const docxVisualInsertDraftSchema = z
  .object({
    type: z.literal('visual').describe('图片视觉节点'),
    imagePath: z.string().min(1).describe('本机图片绝对路径'),
    widthCm: z.number().positive().optional().describe('显示宽度，厘米'),
    heightCm: z.number().positive().optional().describe('显示高度，厘米'),
    altText: z.string().optional().describe('替代文字')
  })
  .strict()

export const docxContentNodeDraftSchema = z.discriminatedUnion('type', [
  docxParagraphDraftSchema,
  docxRunDraftSchema,
  docxHyperlinkDraftSchema,
  docxFieldDraftSchema,
  docxBreakDraftSchema,
  docxVisualDraftSchema
])

const docxContentInsertNodeDraftSchema = z.discriminatedUnion('type', [
  docxParagraphDraftSchema,
  docxRunDraftSchema,
  docxHyperlinkDraftSchema,
  docxFieldDraftSchema,
  docxBreakDraftSchema,
  docxVisualInsertDraftSchema
])

const contentEditBase = { sourcePath: docxWriteSourcePathField }
export const docxContentEditSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...contentEditBase,
      type: z.literal('replace_text').describe('在一个节点内替换原文'),
      nodeId: nodeIdField,
      oldText: z.string().min(1).describe('目标节点内的原文'),
      newText: z.string().describe('替换后的文字'),
      format: nonEmptyRunStyleSchema.optional().describe('被替换文字的样式')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_nodes').describe('插入节点'),
      nodeId: nodeIdField.optional().describe('锚点或容器 nodeId'),
      position: z
        .enum(['before', 'after', 'inside_start', 'inside_end', 'document_end'])
        .describe('插入位置'),
      nodes: z.array(docxContentInsertNodeDraftSchema).min(1).describe('插入的节点')
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.position === 'document_end' && value.nodeId) {
        ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'document_end 不接受 nodeId' })
      }
      if (value.position !== 'document_end' && !value.nodeId) {
        ctx.addIssue({ code: 'custom', path: ['nodeId'], message: '该 position 必须提供 nodeId' })
      }
    }),
  z
    .object({
      ...contentEditBase,
      type: z.literal('replace_node').describe('用一个新节点替换目标节点本身'),
      nodeId: nodeIdField,
      node: docxContentNodeDraftSchema.describe('替换后的节点')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_node').describe('删除一个节点'),
      nodeId: nodeIdField
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('move_node').describe('移动一个节点，保留其 nodeId'),
      nodeId: nodeIdField,
      anchorNodeId: nodeIdField.describe('新的锚点或容器 nodeId'),
      position: z.enum(['before', 'after', 'inside_start', 'inside_end']).describe('移动位置')
    })
    .strict()
])

const rejectDuplicateNodeIds = (value: { nodeIds: string[] }, context: z.RefinementCtx): void => {
  const seen = new Set<string>()
  value.nodeIds.forEach((nodeId, index) => {
    if (seen.has(nodeId)) {
      context.addIssue({
        code: 'custom',
        path: ['nodeIds', index],
        message: 'nodeIds 不允许重复'
      })
    }
    seen.add(nodeId)
  })
}

export const docxFormatSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_text'),
      targets: z
        .array(
          z
            .object({
              nodeId: nodeIdField,
              text: z
                .string()
                .min(1)
                .optional()
                .describe('要格式化的文字；省略则格式化节点内全部文字')
            })
            .strict()
        )
        .min(1)
        .max(DOCX_FORMAT_MAX_TARGETS)
        .superRefine((targets, context) => {
          const seen = new Set<string>()
          targets.forEach((target, index) => {
            if (seen.has(target.nodeId)) {
              context.addIssue({
                code: 'custom',
                path: [index, 'nodeId'],
                message: 'targets 不允许重复 nodeId'
              })
            }
            seen.add(target.nodeId)
          })
        }),
      format: nonEmptyRunStyleSchema.describe('文字格式 patch')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_paragraph'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      format: nonEmptyParagraphStyleSchema.describe('段落格式 patch')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_section'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      orientation: z.enum(['portrait', 'landscape']).optional().describe('页面方向'),
      marginTopPt: z.number().min(0).optional().describe('上页边距，磅'),
      marginRightPt: z.number().min(0).optional().describe('右页边距，磅'),
      marginBottomPt: z.number().min(0).optional().describe('下页边距，磅'),
      marginLeftPt: z.number().min(0).optional().describe('左页边距，磅')
    })
    .strict()
    .refine(
      (value) =>
        value.orientation !== undefined ||
        value.marginTopPt !== undefined ||
        value.marginRightPt !== undefined ||
        value.marginBottomPt !== undefined ||
        value.marginLeftPt !== undefined,
      { message: 'format_section 至少设置一个格式属性' }
    )
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('reset_format'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS)
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('apply_named_style'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      styleId: z.string().trim().min(1).describe('要应用的 styleId')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('create_named_style'),
      styleId: z.string().trim().min(1).describe('新样式的唯一 styleId'),
      name: z.string().trim().min(1).describe('样式显示名称'),
      basedOnStyleId: z.string().trim().min(1).optional().describe('可选的基础样式 styleId'),
      paragraph: docxParagraphStyleSchema.optional().describe('段落属性'),
      run: docxRunStyleSchema.optional().describe('文字属性')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('update_named_style'),
      styleId: z.string().trim().min(1).describe('要全局修改的 styleId'),
      name: z.string().trim().min(1).optional().describe('新显示名称'),
      paragraph: nonEmptyParagraphStyleSchema.optional().describe('段落属性 patch'),
      run: nonEmptyRunStyleSchema.optional().describe('文字属性 patch')
    })
    .strict()
    .refine(
      (value) =>
        value.name !== undefined || value.paragraph !== undefined || value.run !== undefined,
      { message: 'update_named_style 至少设置一个属性' }
    ),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_named_style'),
      styleId: z.string().trim().min(1).describe('要删除的 styleId'),
      replacementStyleId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe('样式仍被引用时用于替换的 styleId')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('set_numbering'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      kind: z.enum(['bullet', 'decimal', 'none']).describe('项目符号、数字编号或清除编号'),
      level: z.number().int().min(0).max(8).optional().describe('编号层级')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds)
])

const tableRowsField = z.array(z.array(z.string()).min(1)).min(1).describe('表格二维文本数组')
const createTableSchema = z
  .object({
    ...contentEditBase,
    type: z.literal('create_table'),
    nodeId: nodeIdField.optional().describe('锚点 nodeId'),
    position: z.enum(['before', 'after', 'document_end']).describe('表格插入位置'),
    rows: tableRowsField
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.position === 'document_end' && value.nodeId) {
      ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'document_end 不接受 nodeId' })
    }
    if (value.position !== 'document_end' && !value.nodeId) {
      ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'before/after 必须提供 nodeId' })
    }
  })

export const docxTableEditSchema = z.discriminatedUnion('type', [
  createTableSchema,
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_table'),
      tableNodeId: nodeIdField
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_row'),
      tableNodeId: nodeIdField,
      rowNodeId: nodeIdField.optional().describe('相邻行 nodeId'),
      position: z.enum(['before', 'after']).optional().describe('相对行位置'),
      cells: z.array(z.string()).min(1).describe('新行各单元格文字')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_row'),
      rowNodeId: nodeIdField
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_column'),
      tableNodeId: nodeIdField,
      columnIndex: z.number().int().min(1).describe('新列插入位置，从 1 开始'),
      cells: z.array(z.string()).optional().describe('逐行的新单元格文字')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_column'),
      tableNodeId: nodeIdField,
      columnIndex: z.number().int().min(1).describe('要删除的列，从 1 开始')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('merge_cells'),
      tableNodeId: nodeIdField,
      fromRow: z.number().int().min(1).describe('起始行，从 1 开始'),
      fromColumn: z.number().int().min(1).describe('起始列，从 1 开始'),
      toRow: z.number().int().min(1).describe('结束行，从 1 开始'),
      toColumn: z.number().int().min(1).describe('结束列，从 1 开始')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('split_cell'),
      cellNodeId: nodeIdField,
      rows: z.number().int().min(1).describe('拆分行数'),
      columns: z.number().int().min(1).describe('拆分列数')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_table'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      format: nonEmptyTableStyleSchema.describe('表格格式 patch')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_row'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      format: nonEmptyRowStyleSchema.describe('行格式 patch')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds),
  z
    .object({
      ...contentEditBase,
      type: z.literal('format_cell'),
      nodeIds: z.array(nodeIdField).min(1).max(DOCX_FORMAT_MAX_TARGETS),
      format: nonEmptyCellStyleSchema.describe('单元格格式 patch')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds)
])

const insertImageSchema = z
  .object({
    ...contentEditBase,
    type: z.literal('insert_image'),
    nodeId: nodeIdField.optional().describe('锚点 nodeId'),
    position: z.enum(['before', 'after', 'document_end']).describe('图片插入位置'),
    imagePath: z.string().min(1).describe('本机图片绝对路径'),
    widthCm: z.number().positive().optional().describe('显示宽度，厘米'),
    heightCm: z.number().positive().optional().describe('显示高度，厘米'),
    altText: z.string().optional().describe('替代文字')
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.position === 'document_end' && value.nodeId) {
      ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'document_end 不接受 nodeId' })
    }
    if (value.position !== 'document_end' && !value.nodeId) {
      ctx.addIssue({ code: 'custom', path: ['nodeId'], message: 'before/after 必须提供 nodeId' })
    }
  })

export const docxInternalMediaOperationSchema = z.discriminatedUnion('type', [
  insertImageSchema,
  z
    .object({
      ...contentEditBase,
      type: z.literal('replace_image'),
      nodeId: z.string().min(1).describe('视觉对象 ID'),
      imagePath: z.string().min(1).describe('新图片绝对路径')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_media'),
      nodeId: z.string().min(1).describe('要删除的 nodeId')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('update_image'),
      nodeId: z.string().min(1).describe('要修改的 nodeId'),
      widthCm: z.number().positive().optional().describe('显示宽度，厘米'),
      heightCm: z.number().positive().optional().describe('显示高度，厘米'),
      altText: z.string().optional().describe('替代文字')
    })
    .strict()
    .refine(
      (value) =>
        value.widthCm !== undefined || value.heightCm !== undefined || value.altText !== undefined,
      { message: 'update_image 至少设置一个属性' }
    )
])

export const docxCommentsRevisionsSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...contentEditBase,
      type: z.literal('add_comment'),
      nodeId: nodeIdField,
      text: z.string().min(1).describe('目标节点中要锚定的文字'),
      comment: z.string().min(1).describe('批注正文'),
      author: z.string().trim().min(1).optional().describe('批注作者')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('update_comment'),
      commentId: z.string().min(1).describe('批注 ID'),
      comment: z.string().min(1).describe('新批注正文')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('reply_comment'),
      commentId: z.string().min(1).describe('父批注 ID'),
      comment: z.string().min(1).describe('回复正文'),
      author: z.string().trim().min(1).optional().describe('回复作者')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_comment'),
      commentId: z.string().min(1).describe('要删除的批注 ID')
    })
    .strict(),
  z.object({ ...contentEditBase, type: z.literal('enable_track_changes') }).strict(),
  z.object({ ...contentEditBase, type: z.literal('disable_track_changes') }).strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('accept_revision'),
      revisionId: z.string().min(1).describe('要接受的修订 ID')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('reject_revision'),
      revisionId: z.string().min(1).describe('要拒绝的修订 ID')
    })
    .strict(),
  z.object({ ...contentEditBase, type: z.literal('accept_all_revisions') }).strict(),
  z.object({ ...contentEditBase, type: z.literal('reject_all_revisions') }).strict()
])

export type {
  DocxMutationOutput,
  DocxOutlineOutput,
  DocxReadOutput,
  DocxSearchOutput
} from './outputTypes'
