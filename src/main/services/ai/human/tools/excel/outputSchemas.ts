import { z } from 'zod/v4'

const rangeCellOutputSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z
    .object({
      formula: z.string(),
      value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional()
    })
    .strict()
])

const styleCellOutputSchema = z.union([
  z.null(),
  z
    .object({
      bold: z.boolean().optional(),
      fontColor: z.string().optional(),
      fillColor: z.string().optional(),
      numberFormat: z.string().optional()
    })
    .strict()
])

export const excelReadWorkbookOutputSchema = z
  .object({
    sheets: z.array(
      z
        .object({
          name: z.string(),
          range: z.string().nullable(),
          rowCount: z.number().int().min(0),
          columnCount: z.number().int().min(0)
        })
        .strict()
    )
  })
  .strict()

export const excelReadRangeOutputSchema = z
  .object({
    sheetName: z.string(),
    range: z.string(),
    rows: z.array(z.array(rangeCellOutputSchema))
  })
  .strict()

export const excelReadStyleOutputSchema = z
  .object({
    sheetName: z.string(),
    range: z.string(),
    rows: z.array(z.array(styleCellOutputSchema))
  })
  .strict()

export const excelSearchOutputSchema = z
  .object({
    truncated: z.boolean(),
    matches: z.array(
      z
        .object({
          sheetName: z.string(),
          address: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
          formula: z.string().optional()
        })
        .strict()
    )
  })
  .strict()

export const excelReadOutputSchema = z.union([
  excelReadWorkbookOutputSchema,
  excelReadRangeOutputSchema,
  excelReadStyleOutputSchema,
  excelSearchOutputSchema
])

export const excelEditOutputSchema = z.object({}).strict()
