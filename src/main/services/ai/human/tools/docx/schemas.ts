import { z } from 'zod/v4'
import type { DocxCreateTableCellNode } from './nodeTypes'
import { DOCX_FORMAT_MAX_TARGETS, DOCX_OUTLINE_MAX_PAGE_COUNT } from './constants'

const docxHexColorSchema = z
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
    styleId: z.string().trim().min(1).optional().describe('真实段落 styleId，如 Heading1'),
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

const sourcePathField = z
  .string()
  .min(1)
  .describe('DOCX 文件的本机绝对路径；写入工具只支持 .docx，读取工具同时支持只读 .doc')
const nodeIdField = z
  .string()
  .min(1)
  .describe('docx_read_nodes、docx_search 或创建操作 result.createdIds 返回的 nodeId，直接照抄')
const searchScopeNodeIdField = z
  .string()
  .min(1)
  .describe('限定搜索范围的根节点或 table cell nodeId；不接受 run 等递归子节点 ID')

export const docxOutlineSchema = z
  .object({
    sourcePath: sourcePathField,
    startPage: z.number().int().min(1).describe('outline 逻辑起始页，从 1 开始'),
    pageCount: z
      .number()
      .int()
      .min(1)
      .max(DOCX_OUTLINE_MAX_PAGE_COUNT)
      .describe(`连续读取的 outline 逻辑页数，最多 ${String(DOCX_OUTLINE_MAX_PAGE_COUNT)} 页`)
  })
  .strict()

export const docxSearchSchema = z
  .object({
    sourcePath: sourcePathField,
    query: z.string().min(1).describe('要检索的文字或正则表达式'),
    mode: docxSearchModeSchema.optional().describe('检索模式，缺省为 literal'),
    nodeIds: z
      .array(searchScopeNodeIdField)
      .min(1)
      .optional()
      .describe('可选的根节点或 table cell 搜索范围；缺省搜索整个文档'),
    includeContext: z
      .boolean()
      .optional()
      .describe('是否返回命中节点在同一 story 中前后各 2 个根节点的预览')
  })
  .strict()

export const docxReadNodesSchema = z
  .object({
    sourcePath: sourcePathField,
    range: z.discriminatedUnion('type', [
      z
        .object({
          type: z.literal('node_ids').describe('读取指定节点'),
          nodeIds: z.array(nodeIdField).min(1).max(20).describe('要读取的 1 至 20 个 nodeId')
        })
        .strict(),
      z
        .object({
          type: z.literal('node_index').describe('按 outline 临时顺序读取'),
          fromNodeIndex: z.number().int().min(0).describe('起始 nodeIndex，包含'),
          toNodeIndex: z.number().int().min(0).describe('结束 nodeIndex，包含')
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
        message: '单次最多读取 50 个根节点，请先用 outline 或 search 缩小范围'
      })
    }
  })

const docxParagraphDraftSchema = z
  .object({
    type: z.literal('paragraph').describe('段落节点'),
    text: z.string().describe('段落纯文本；换行用 \\n，制表符用 \\t'),
    styleId: z.string().trim().min(1).optional().describe('可选的命名段落样式 styleId')
  })
  .strict()
const docxRunDraftSchema = z
  .object({
    type: z.literal('run').describe('文字 run 节点'),
    text: z.string().describe('run 的纯文本')
  })
  .strict()
const docxHyperlinkDraftSchema = z
  .object({
    type: z.literal('hyperlink').describe('超链接节点'),
    text: z.string().describe('链接显示文字'),
    target: z.string().trim().min(1).describe('链接 URL')
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

export const docxContentNodeDraftSchema = z.discriminatedUnion('type', [
  docxParagraphDraftSchema,
  docxRunDraftSchema,
  docxHyperlinkDraftSchema,
  docxFieldDraftSchema,
  docxBreakDraftSchema
])

const contentEditBase = { sourcePath: sourcePathField }
export const docxContentEditSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...contentEditBase,
      type: z.literal('replace_text').describe('在一个节点内替换确定的原文'),
      nodeId: nodeIdField,
      oldText: z.string().min(1).describe('必须存在于目标节点内的原文'),
      newText: z.string().describe('替换后的文字')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_nodes').describe('在锚点前后或容器内部插入节点'),
      nodeId: nodeIdField.optional().describe('锚点或容器 nodeId；document_end 时不填'),
      position: z
        .enum(['before', 'after', 'inside_start', 'inside_end', 'document_end'])
        .describe('插入位置'),
      nodes: z.array(docxContentNodeDraftSchema).min(1).describe('按顺序插入的浅层节点')
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
      node: docxContentNodeDraftSchema.describe('替换后的浅层节点'),
      allowVisualLoss: z.literal(true).optional().describe('目标含视觉内容时必须明确允许丢失')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_node').describe('删除一个节点'),
      nodeId: nodeIdField,
      allowVisualLoss: z.literal(true).optional().describe('目标含视觉内容时必须明确允许丢失')
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
                .describe('目标节点内要格式化的精确文字；省略时格式化节点内全部文字')
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
      level: z.number().int().min(0).max(8).optional().describe('编号层级，缺省为 0')
    })
    .strict()
    .superRefine(rejectDuplicateNodeIds)
])

const tableRowsField = z.array(z.array(z.string()).min(1)).min(1).describe('表格二维文本数组')
const createTableSchema = z
  .object({
    ...contentEditBase,
    type: z.literal('create_table'),
    nodeId: nodeIdField.optional().describe('锚点 nodeId；document_end 时不填'),
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
      tableNodeId: nodeIdField,
      allowVisualLoss: z.literal(true).optional().describe('表格含视觉内容时必须明确允许丢失')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_row'),
      tableNodeId: nodeIdField,
      rowNodeId: nodeIdField.optional().describe('相邻行 nodeId；缺省追加'),
      position: z.enum(['before', 'after']).optional().describe('相对行位置，缺省 after'),
      cells: z.array(z.string()).min(1).describe('新行各单元格文字')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_row'),
      rowNodeId: nodeIdField,
      allowVisualLoss: z.literal(true).optional().describe('行内含视觉内容时必须明确允许丢失')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('insert_column'),
      tableNodeId: nodeIdField,
      columnIndex: z.number().int().min(1).describe('新列插入位置，从 1 开始'),
      cells: z.array(z.string()).optional().describe('逐行的新单元格文字，缺省为空')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_column'),
      tableNodeId: nodeIdField,
      columnIndex: z.number().int().min(1).describe('要删除的列，从 1 开始'),
      allowVisualLoss: z.literal(true).optional().describe('列内含视觉内容时必须明确允许丢失')
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
      toColumn: z.number().int().min(1).describe('结束列，从 1 开始'),
      allowVisualLoss: z
        .literal(true)
        .optional()
        .describe('被合并单元格含视觉内容时必须明确允许丢失')
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
    .strict()
])

const insertImageSchema = z
  .object({
    ...contentEditBase,
    type: z.literal('insert_image'),
    nodeId: nodeIdField.optional().describe('锚点 nodeId；document_end 时不填'),
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

export const docxMediaEditSchema = z.discriminatedUnion('type', [
  insertImageSchema,
  z
    .object({
      ...contentEditBase,
      type: z.literal('replace_image'),
      visualId: z.string().min(1).describe('docx_read_nodes 返回的 visualId'),
      imagePath: z.string().min(1).describe('新图片绝对路径')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('delete_media'),
      visualId: z.string().min(1).describe('要删除的 visualId')
    })
    .strict(),
  z
    .object({
      ...contentEditBase,
      type: z.literal('update_image'),
      visualId: z.string().min(1).describe('要修改的 visualId'),
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
