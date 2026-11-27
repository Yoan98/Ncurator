import { z } from 'zod/v4'
import { drawingFormatSchema } from '../../../../media/engine/protocol'

export const drawingSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1)
      .describe('完整绘画或动画要求；素材、已有场景路径和项目约定直接写入此处'),
    format: drawingFormatSchema.describe(
      '成品格式；png/jpeg/webp 为静态图片，mp4/webm 为动画，WebM 支持透明'
    )
  })
  .strict()
export type DrawingInput = z.infer<typeof drawingSchema>
export type DrawingOutput = { result: string } | { error: string }
