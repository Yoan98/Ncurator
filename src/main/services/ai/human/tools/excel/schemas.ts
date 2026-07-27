import { z } from 'zod/v4'

const sourcePathSchema = z.string().trim().min(1)
const sheetNameSchema = z.string().trim().min(1)

export const excelReadOutlineSchema = z.object({ sourcePath: sourcePathSchema }).strict()

export const excelSearchSchema = z
  .object({
    sourcePath: sourcePathSchema,
    query: z.string().min(1),
    mode: z.enum(['literal', 'regex']).optional(),
    scope: z
      .object({ sheetNames: z.array(sheetNameSchema).min(1).optional() })
      .strict()
      .optional()
  })
  .strict()

export const excelReadCellsSchema = z
  .object({
    sourcePath: sourcePathSchema,
    ranges: z
      .array(z.object({ sheetName: sheetNameSchema, range: z.string().trim().min(1) }).strict())
      .min(1)
  })
  .strict()

const styleSchema = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    fontColor: z.string().optional(),
    fillColor: z.string().optional(),
    numberFormat: z.string().optional(),
    horizontalAlignment: z.enum(['left', 'center', 'right']).optional(),
    verticalAlignment: z.enum(['top', 'middle', 'bottom']).optional()
  })
  .strict()

const cellValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
const rangeCellSchema = z.union([cellValueSchema, z.object({ formula: z.string() }).strict()])
const setCellSchema = z
  .object({
    type: z.literal('set_cell'),
    sheetName: sheetNameSchema,
    address: z.string().trim().min(1),
    value: cellValueSchema.optional(),
    formula: z.string().optional(),
    style: styleSchema.optional()
  })
  .strict()
  .refine((value) => value.value !== undefined || value.formula !== undefined, {
    message: 'set_cell requires value or formula'
  })

const deleteCellSchema = z
  .object({
    type: z.literal('delete_cell'),
    sheetName: sheetNameSchema,
    address: z.string().trim().min(1)
  })
  .strict()

const setRangeSchema = z
  .object({
    type: z.literal('set_range'),
    sheetName: sheetNameSchema,
    startCell: z.string().trim().min(1),
    values: z.array(z.array(rangeCellSchema).min(1)).min(1),
    style: styleSchema.optional()
  })
  .strict()

const clearRangeSchema = z
  .object({
    type: z.literal('clear_range'),
    sheetName: sheetNameSchema,
    range: z.string().trim().min(1)
  })
  .strict()

const insertRowsSchema = z
  .object({
    type: z.literal('insert_rows'),
    sheetName: sheetNameSchema,
    startRow: z.number().int().min(1),
    count: z.number().int().min(1)
  })
  .strict()

const deleteRowsSchema = z
  .object({
    type: z.literal('delete_rows'),
    sheetName: sheetNameSchema,
    startRow: z.number().int().min(1),
    count: z.number().int().min(1)
  })
  .strict()

const setColumnWidthSchema = z
  .object({
    type: z.literal('set_column_width'),
    sheetName: sheetNameSchema,
    column: z.union([z.string().trim().min(1), z.number().int().min(1)]),
    width: z.number().positive()
  })
  .strict()

const addSheetSchema = z
  .object({ type: z.literal('add_sheet'), sheetName: sheetNameSchema })
  .strict()
const deleteSheetSchema = z
  .object({ type: z.literal('delete_sheet'), sheetName: sheetNameSchema })
  .strict()
const renameSheetSchema = z
  .object({ type: z.literal('rename_sheet'), sheetName: sheetNameSchema, newName: sheetNameSchema })
  .strict()
const mergeCellsSchema = z
  .object({
    type: z.literal('merge_cells'),
    sheetName: sheetNameSchema,
    range: z.string().trim().min(1)
  })
  .strict()

export const excelEditOperationSchema = z.discriminatedUnion('type', [
  setCellSchema,
  deleteCellSchema,
  setRangeSchema,
  clearRangeSchema,
  insertRowsSchema,
  deleteRowsSchema,
  setColumnWidthSchema,
  addSheetSchema,
  deleteSheetSchema,
  renameSheetSchema,
  mergeCellsSchema
])

export const excelEditSchema = z
  .object({
    sourcePath: sourcePathSchema,
    action: z.enum(['create', 'update']),
    sheets: z.array(sheetNameSchema).optional(),
    operations: z.array(excelEditOperationSchema).min(1)
  })
  .strict()

export type ExcelEditInput = z.infer<typeof excelEditSchema>
