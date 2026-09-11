import { z } from 'zod/v4'

const IMAGE_OUTPUT_EXTENSION_PATTERN = /\.(?:png|jpe?g|webp)$/iu

export const imageGenerateSchema = z
  .object({
    outputPath: z
      .string()
      .trim()
      .min(1)
      .describe('输出图片路径；扩展名决定格式，支持 .png、.jpg、.jpeg、.webp')
      .refine((value) => IMAGE_OUTPUT_EXTENSION_PATTERN.test(value), {
        message: 'outputPath must end with .png, .jpg, .jpeg, or .webp'
      })
      .meta({ 'x-constraint': 'outputPath must end with .png, .jpg, .jpeg, or .webp' }),
    svg: z.string().min(1).describe('SVG 源码')
  })
  .strict()

export type ImageGenerateInput = z.infer<typeof imageGenerateSchema>

export type { ImageGenerateOutput } from './outputTypes'
