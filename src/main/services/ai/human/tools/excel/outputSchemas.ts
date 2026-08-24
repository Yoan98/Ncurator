import { z } from 'zod/v4'

const excelCellOutputSchema = z.object({
  sheetName: z.string(),
  address: z.string(),
  value: z.any(),
  displayValue: z.string(),
  formula: z.string().optional(),
  type: z.string(),
  numberFormat: z.string().optional()
})

const excelChangeOutputSchema = z.object({
  sheetName: z.string(),
  address: z.string(),
  kind: z.enum(['added', 'modified', 'deleted'])
})

export const excelReadOutlineOutputSchema = z.object({
  sourcePath: z.string(),
  sheetCount: z.number().int().min(0),
  sheets: z.array(
    z.object({
      name: z.string(),
      index: z.number().int().min(0),
      range: z.string().nullable(),
      rowCount: z.number().int().min(0),
      columnCount: z.number().int().min(0),
      formulaCount: z.number().int().min(0),
      tables: z.array(z.string())
    })
  )
})

export const excelSearchOutputSchema = z.object({
  sourcePath: z.string(),
  query: z.string(),
  matches: z.array(
    z.object({
      matchType: z.enum(['sheet_name', 'table_name', 'table_column']).optional(),
      sheetName: z.string(),
      tableName: z.string().optional(),
      columnName: z.string().optional(),
      address: z.string().optional(),
      value: z.any().optional(),
      displayValue: z.string().optional(),
      formula: z.string().optional(),
      type: z.string().optional(),
      numberFormat: z.string().optional()
    })
  ),
  truncated: z.boolean()
})

export const excelReadCellsOutputSchema = z.object({
  sourcePath: z.string(),
  cells: z.array(excelCellOutputSchema)
})

export const excelEditOutputSchema = z.object({
  sourcePath: z.string(),
  changed: z.boolean(),
  changes: z.array(excelChangeOutputSchema),
  diffPath: z.string().optional(),
  record: z
    .object({
      id: z.string(),
      sessionId: z.string(),
      runId: z.string(),
      status: z.string(),
      capability: z.literal('excel'),
      path: z.string(),
      fileName: z.string(),
      operation: z.enum(['created', 'updated']),
      source: z.literal('excel_tool'),
      beforePath: z.string().optional(),
      afterPath: z.string(),
      changeCount: z.number().int().min(0),
      insertCount: z.number().int().min(0),
      deleteCount: z.number().int().min(0),
      beforeSnapshotPath: z.string().optional(),
      afterSnapshotPath: z.string().optional(),
      beforeChecksum: z.string().optional(),
      afterChecksum: z.string(),
      previewPath: z.string(),
      runSummary: z.string(),
      createdAt: z.number(),
      updatedAt: z.number()
    })
    .optional()
})
