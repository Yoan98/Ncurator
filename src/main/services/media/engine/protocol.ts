import { z } from 'zod/v4'

export const sceneManifestSchema = z
  .object({
    entry: z
      .string()
      .min(1)
      .default('scene.mjs')
      .describe('场景目录内的入口相对路径，支持 .mjs 或静态 .svg'),
    canvas: z
      .object({
        width: z.number().int().min(2).max(8192).describe('画布宽度，像素'),
        height: z.number().int().min(2).max(8192).describe('画布高度，像素'),
        fps: z.number().positive().max(120).default(30).describe('输出帧率')
      })
      .strict()
      .describe('画布配置，总像素不超过 33554432'),
    durationSeconds: z.number().positive().describe('场景时长，秒；静态作品也需填写'),
    resources: z
      .record(z.string(), z.string())
      .default({})
      .describe(
        '素材名称到本地文件路径的映射；相对路径以 scene.json 所在目录为基准，也支持绝对路径'
      ),
    seed: z.number().int().default(1).describe('供代码生成可重复随机内容的种子')
  })
  .strict()
  .refine((value) => value.canvas.width * value.canvas.height <= 33_554_432, {
    message: 'Scene canvas exceeds 33554432 pixels'
  })

export type SceneManifest = z.infer<typeof sceneManifestSchema>

export const drawingFormatSchema = z.enum(['png', 'jpeg', 'webp', 'mp4', 'webm'])
export type DrawingFormat = z.infer<typeof drawingFormatSchema>
export const drawingRenderResultSchema = z
  .object({
    scenePath: z.string().min(1),
    outputPath: z.string().min(1)
  })
  .strict()
export type DrawingRenderResult = z.infer<typeof drawingRenderResultSchema>
