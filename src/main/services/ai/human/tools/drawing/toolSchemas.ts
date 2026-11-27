import { z } from 'zod/v4'

export const drawingSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .describe('图片或动画的创作、修改要求，包括风格、尺寸、时长及需要保留的内容'),
    references: z
      .array(z.string().trim().min(1))
      .optional()
      .describe('本地参考素材或旧作品的绝对路径'),
    outputPath: z
      .string()
      .trim()
      .min(1)
      .regex(/\.(png|jpe?g|webp|mp4|webm)$/iu)
      .describe('新版本成品的绝对路径；扩展名决定格式，WebM 可透明；不可覆盖已有文件')
  })
  .strict()
export type DrawingInput = z.infer<typeof drawingSchema>
export type DrawingOutput = { sourcePath: string } | { error: string }
