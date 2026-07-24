import { z } from 'zod/v4'

const indexSchema = z.number().int().min(1)

export const visualRecognitionRequestSchema = z
  .object({
    index: indexSchema,
    instruction: z.string().trim().min(1)
  })
  .strict()

export const visualRecognitionResultSchema = z.union([
  z
    .object({
      index: indexSchema,
      text: z.string().min(1)
    })
    .strict(),
  z
    .object({
      index: indexSchema,
      error: z.string().min(1)
    })
    .strict()
])

export const visualRecognitionOutputSchema = z
  .object({
    sourcePath: z.string(),
    results: z.array(visualRecognitionResultSchema)
  })
  .strict()
