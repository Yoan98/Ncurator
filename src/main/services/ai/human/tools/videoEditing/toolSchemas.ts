import { z } from 'zod/v4'

const seconds = z.number().finite().nonnegative().describe('时间，单位秒')
export const timeRangeSchema = z
  .object({
    startSeconds: seconds.describe('区间起点，秒，包含'),
    endSeconds: seconds.describe('区间终点，秒，不包含')
  })
  .strict()
  .refine((value) => value.endSeconds > value.startSeconds, {
    message: 'Time range must satisfy startSeconds < endSeconds'
  })
export const boxSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1)
  })
  .strict()
  .refine((value) => value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001, {
    message: 'Box must fit within normalized canvas'
  })
  .describe('归一化布局框，坐标和尺寸取值为 0 到 1')
const file = z.string().trim().min(1).describe('本地绝对路径')
const fps = z
  .string()
  .regex(/^\d+(?:\/\d+)?$/u)
  .refine((value) => {
    const [n, d = 1] = value.split('/').map(Number)
    return n > 0 && d > 0 && n / d <= 120
  }, 'Invalid frame rate')
  .describe('帧率，例如 30 或 30000/1001')
const size = z
  .object({ width: z.number().int().min(2).max(8192), height: z.number().int().min(2).max(8192) })
  .strict()
const io = {
  inputPath: file.describe('视频或已保存编辑配方的绝对路径'),
  outputPath: file.describe('新版本预览或成品路径，不覆盖已有文件')
}
const fit = z
  .enum(['contain', 'cover'])
  .describe('contain 保持完整画面并留边（默认）；cover 填满并裁去超出部分')
const mask = z
  .object({
    shape: z.enum(['rectangle', 'circle', 'rounded-rect']),
    radius: z.number().nonnegative().optional().describe('圆角半径，原画布像素；默认短边的 8%')
  })
  .strict()
export const textStyleSchema = z
  .object({
    fontFamily: z.string().optional().describe('字体族，默认内置 NcuratorSceneSans（支持中文）'),
    fontSize: z.number().positive().optional().describe('原编辑画布中的字号，像素'),
    color: z.string().optional().describe('CSS 文字颜色，默认白色'),
    backgroundColor: z.string().optional().describe('CSS 文字背景色，默认透明'),
    strokeColor: z.string().optional().describe('CSS 文字描边色，默认深灰'),
    strokeWidth: z.number().nonnegative().optional().describe('文字描边宽度，原画布像素'),
    box: boxSchema.optional().describe('归一化文字布局框；字幕默认位于画面下部'),
    align: z.enum(['left', 'center', 'right']).optional().describe('默认居中')
  })
  .strict()
const binding = z
  .enum(['content', 'timeline'])
  .describe('content 随素材剪切变速；timeline 固定绝对时间')

export const videoClipEditSchema = z.discriminatedUnion('operation', [
  z
    .object({
      operation: z.literal('compose'),
      outputPath: io.outputPath,
      clips: z
        .array(
          z
            .object({
              path: file,
              sourceRange: timeRangeSchema.optional(),
              durationSeconds: z
                .number()
                .positive()
                .optional()
                .describe('静态图片的显示时长，秒；图片必填，视频按 sourceRange 取段'),
              includeAudio: z.boolean().optional().describe('是否保留素材原声，默认 true'),
              fit: fit.optional()
            })
            .strict()
        )
        .min(1),
      canvas: size
        .extend({ fps })
        .optional()
        .describe('编辑画布；默认使用首段视频尺寸帧率，全图片时必填')
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('cut'),
      mode: z.enum(['keep', 'remove']),
      ranges: z.array(timeRangeSchema).min(1)
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('replace'),
      clipId: z.string().min(1).describe('已有编辑配方中的片段 ID'),
      path: file.describe('替换素材的绝对路径；保留片段起点、时长和倍率，视频须覆盖原素材范围')
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('speed'),
      startSeconds: seconds,
      endSeconds: seconds,
      rate: z.number().positive().describe('播放倍率，例如 2 表示 2 倍速'),
      preservePitch: z.boolean().optional().describe('变速保留音高，默认 true'),
      mute: z.boolean().optional().describe('静音变速区间，默认 false')
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('freeze'),
      atSeconds: seconds,
      durationSeconds: z.number().positive().describe('定格时长，秒')
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('repeat'),
      startSeconds: seconds,
      endSeconds: seconds,
      count: z.number().int().min(1).max(100).optional().describe('额外重复次数，默认 1'),
      includeAudio: z.boolean().optional().describe('重复副本是否包含原声，默认 false')
    })
    .strict()
])

const captionEntry = z.object({ text: z.string().min(1), range: timeRangeSchema }).strict()
const captions = [
  z
    .object({
      ...io,
      operation: z.literal('captions'),
      action: z.literal('add'),
      entries: z.array(captionEntry).min(1).optional(),
      subtitlePath: file.optional().describe('UTF-8 SRT/VTT 文件，与 entries 二选一'),
      style: textStyleSchema.optional()
    })
    .strict()
    .refine((value) => Boolean(value.entries) !== Boolean(value.subtitlePath), {
      message: 'Provide exactly one of entries or subtitlePath'
    }),
  z
    .object({
      ...io,
      operation: z.literal('captions'),
      action: z.literal('update'),
      edits: z
        .array(
          z
            .object({
              id: z.string().min(1),
              text: z.string().min(1).optional(),
              range: timeRangeSchema.optional(),
              style: textStyleSchema.optional().describe('仅更新传入属性，未传入属性保留')
            })
            .strict()
        )
        .min(1)
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('captions'),
      action: z.literal('remove'),
      ids: z.array(z.string().min(1)).min(1)
    })
    .strict()
] as const
const overlayContent = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('media'), path: file, sourceRange: timeRangeSchema.optional() })
    .strict(),
  z
    .object({ kind: z.literal('text'), text: z.string().min(1), style: textStyleSchema.optional() })
    .strict()
])
const overlayFields = {
  range: timeRangeSchema,
  content: overlayContent,
  box: boxSchema,
  fit: fit.optional(),
  opacity: z.number().min(0).max(1).optional().describe('不透明度，默认 1'),
  mask: mask.optional(),
  includeAudio: z.boolean().optional().describe('叠加素材原声，默认 false'),
  binding: binding.optional().describe('叠加默认 content，跟随素材剪切'),
  followRate: z.boolean().optional().describe('跟随内容变速，默认 true')
}
export const overlaySchema = z.object(overlayFields)
export const videoVisualEditSchema = z.union([
  ...captions,
  z
    .object({ ...io, operation: z.literal('overlay'), action: z.literal('add'), ...overlayFields })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('overlay'),
      action: z.literal('update'),
      id: z.string().min(1),
      changes: overlaySchema.partial().strict()
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('overlay'),
      action: z.literal('remove'),
      id: z.string().min(1)
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('layout'),
      range: timeRangeSchema.optional(),
      crop: boxSchema.optional(),
      placement: boxSchema.optional(),
      fit: fit.optional(),
      mask: mask.optional(),
      keyframes: z
        .array(
          z
            .object({
              timeSeconds: seconds,
              crop: boxSchema.optional(),
              placement: boxSchema.optional()
            })
            .strict()
        )
        .min(1)
        .optional(),
      easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']).optional()
    })
    .strict(),
  z
    .object({
      ...io,
      operation: z.literal('transition'),
      atSeconds: seconds,
      type: z.enum(['cut', 'fade', 'wipe-left']),
      durationSeconds: z.number().positive().optional().describe('转场时长，秒')
    })
    .strict()
])
const audioFields = {
  path: file,
  range: timeRangeSchema,
  sourceStartSeconds: seconds.optional().describe('音轨素材起点，秒，默认 0'),
  gainDb: z.number().finite().optional().describe('增益，dB，默认 0'),
  fadeInSeconds: seconds.optional(),
  fadeOutSeconds: seconds.optional(),
  loop: z.boolean().optional().describe('循环填满指定区间，默认 false'),
  binding: binding.optional().describe('音轨默认 timeline；content 随内容剪切变速'),
  followRate: z.boolean().optional().describe('绑定 content 时是否跟随变速，默认 true'),
  envelope: z
    .array(
      z
        .object({
          atSeconds: seconds.describe('相对音轨开始的秒数，递增'),
          gainDb: z.number().finite()
        })
        .strict()
    )
    .optional()
    .describe('相对 gainDb 叠加的增益包络，点间线性插值'),
  sync: z
    .object({
      anchors: z
        .array(z.object({ videoSeconds: seconds, sourceSeconds: seconds }).strict())
        .min(1)
        .max(2)
    })
    .strict()
    .optional()
    .describe('1 个锚点对齐偏移，2 个锚点同时校正时钟漂移；均为绝对素材/成片秒数')
}
export const audioSchema = z.object(audioFields)
export const videoAudioEditSchema = z.discriminatedUnion('action', [
  z.object({ ...io, action: z.literal('add'), ...audioFields }).strict(),
  z
    .object({
      ...io,
      action: z.literal('update'),
      id: z.string().min(1),
      changes: audioSchema.partial().strict()
    })
    .strict(),
  z.object({ ...io, action: z.literal('remove'), id: z.string().min(1) }).strict()
])
export const videoExportSchema = z
  .object({
    ...io,
    quality: z
      .enum(['preview', 'final'])
      .optional()
      .describe('默认 final；preview 限制到最高 720p 且不改变编辑画布'),
    size: size.optional().describe('导出像素尺寸，默认编辑画布'),
    fps: fps.optional()
  })
  .strict()
export type ClipEditInput = z.infer<typeof videoClipEditSchema>
export type VisualEditInput = z.infer<typeof videoVisualEditSchema>
export type AudioEditInput = z.infer<typeof videoAudioEditSchema>
export type ExportInput = z.infer<typeof videoExportSchema>
export type TimeRange = z.infer<typeof timeRangeSchema>
export type Box = z.infer<typeof boxSchema>
export type TextStyle = z.infer<typeof textStyleSchema>
export type OverlayFields = z.infer<typeof overlaySchema>
export type AudioFields = z.infer<typeof audioSchema>
export type VideoEditOutput = { editPath: string; createdIds?: string[] } | { error: string }
