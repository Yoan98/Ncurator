import { z } from 'zod/v4'

const IMAGE_OUTPUT_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp)$/iu

export const imageGenerateSchema = z
  .object({
    outputPath: z
      .string()
      .trim()
      .min(1)
      .refine((value) => IMAGE_OUTPUT_EXTENSION_PATTERN.test(value), {
        message: 'outputPath must end with .png, .jpg, .jpeg, or .webp'
      })
      .meta({ 'x-constraint': 'outputPath must end with .png, .jpg, .jpeg, or .webp' }),
    svg: z.string().min(1)
  })
  .strict()

export const imageGenerateOutputSchema = z.union([
  z.object({ outputPath: z.string().min(1) }).strict(),
  z.object({ error: z.string().min(1) }).strict()
])

export type ImageGenerateInput = z.infer<typeof imageGenerateSchema>
export type ImageGenerateOutput = z.infer<typeof imageGenerateOutputSchema>
