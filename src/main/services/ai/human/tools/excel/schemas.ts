import { z } from 'zod/v4'

const sourcePathSchema = z.string().trim().min(1).describe('Excel 文件本机绝对路径')
const sheetNameSchema = z.string().trim().min(1).describe('工作表名')
const a1RangeSchema = z.string().trim().min(1).describe('A1 范围，如 A1 或 A1:C20')

const styleSchema = z
  .object({
    bold: z.boolean().optional().describe('是否加粗'),
    italic: z.boolean().optional().describe('是否斜体'),
    fontColor: z.string().optional().describe('字体颜色，如 FF0000'),
    fillColor: z.string().optional().describe('填充色，如 FFD14343'),
    numberFormat: z.string().optional().describe('数字格式，如 #,##0 或 0%'),
    horizontalAlignment: z.enum(['left', 'center', 'right']).optional().describe('水平对齐'),
    verticalAlignment: z.enum(['top', 'middle', 'bottom']).optional().describe('垂直对齐')
  })
  .strict()
  .meta({ id: 'ExcelStyle' })

const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const rangeCellSchema = z.union([
  cellValueSchema,
  z.object({ formula: z.string().min(1).describe('公式，不含前导 =') }).strict()
])

const editBase = { sourcePath: sourcePathSchema }

export const excelReadSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('workbook').describe('读取工作簿地图'),
      sourcePath: sourcePathSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('range').describe('读取一块网格的值和公式'),
      sourcePath: sourcePathSchema,
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('style').describe('读取一块网格的格式'),
      sourcePath: sourcePathSchema,
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict(),
  z
    .object({
      type: z.literal('search').describe('按值或公式搜索格子'),
      sourcePath: sourcePathSchema,
      query: z.string().min(1).describe('搜索文字或正则'),
      sheetName: sheetNameSchema.optional().describe('限定工作表；省略则全书'),
      mode: z.enum(['literal', 'regex']).optional().describe('literal 或 regex，缺省 literal')
    })
    .strict()
])

export const excelEditSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...editBase,
      type: z.literal('add_sheet').describe('新增工作表'),
      sheetName: sheetNameSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('delete_sheet').describe('删除工作表'),
      sheetName: sheetNameSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('rename_sheet').describe('重命名工作表'),
      sheetName: sheetNameSchema,
      newName: sheetNameSchema.describe('新工作表名')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('set_range').describe('写入一块数据或公式'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema.describe('单格为起点，或与 values 行列一致的矩形'),
      values: z.array(z.array(rangeCellSchema).min(1)).min(1).describe('二维值，从上到下、从左到右'),
      style: styleSchema.optional().describe('可选；省略则保留原样式')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('clear_range').describe('清空范围中的值'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('merge_cells').describe('合并单元格'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('unmerge_cells').describe('取消合并'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('insert_rows').describe('插入空行'),
      sheetName: sheetNameSchema,
      startRow: z.number().int().min(1).describe('起始行号，从 1 开始'),
      count: z.number().int().min(1).describe('插入行数')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('delete_rows').describe('删除行'),
      sheetName: sheetNameSchema,
      startRow: z.number().int().min(1).describe('起始行号，从 1 开始'),
      count: z.number().int().min(1).describe('删除行数')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('insert_columns').describe('插入空列'),
      sheetName: sheetNameSchema,
      startColumn: z
        .union([z.string().trim().min(1), z.number().int().min(1)])
        .describe('起始列，字母或从 1 开始的列号'),
      count: z.number().int().min(1).describe('插入列数')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('delete_columns').describe('删除列'),
      sheetName: sheetNameSchema,
      startColumn: z
        .union([z.string().trim().min(1), z.number().int().min(1)])
        .describe('起始列，字母或从 1 开始的列号'),
      count: z.number().int().min(1).describe('删除列数')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('set_style').describe('只改样式，不改值'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema,
      style: styleSchema
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('set_column_width').describe('设置列宽'),
      sheetName: sheetNameSchema,
      column: z
        .union([z.string().trim().min(1), z.number().int().min(1)])
        .describe('列字母或从 1 开始的列号'),
      width: z.number().positive().describe('列宽')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('set_row_height').describe('设置行高'),
      sheetName: sheetNameSchema,
      row: z.number().int().min(1).describe('行号，从 1 开始'),
      height: z.number().positive().describe('行高')
    })
    .strict(),
  z
    .object({
      ...editBase,
      type: z.literal('auto_fit').describe('按内容自适应列宽'),
      sheetName: sheetNameSchema,
      range: a1RangeSchema
    })
    .strict()
])

export type ExcelReadInput = z.infer<typeof excelReadSchema>
export type ExcelEditInput = z.infer<typeof excelEditSchema>
export type ExcelStyle = z.infer<typeof styleSchema>
