import { z } from 'zod/v4'
import type { JsonObject, JsonValue } from '../../../../shared/types'

export const jsonObjectSchema: z.ZodType<JsonObject> = z.lazy(() =>
  z.object({}).catchall(jsonValueSchema)
)

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    jsonObjectSchema
  ])
)

export const toolResourceContextSchema = z.object({
  family: z.string().min(1),
  sourcePath: z.string().min(1).optional(),
  currentRevisionRef: z.string().min(1).optional(),
  previousRevisionRef: z.string().min(1).optional(),
  effectKind: z.string().min(1).optional()
})
