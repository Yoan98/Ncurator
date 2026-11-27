import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod/v4'
import { loadImage } from '@napi-rs/canvas'
import type { VideoFeedbackNode } from '../../../shared/types'
import { getPartnerAssetsRootDir } from '../assets/WorkspaceAssetService'

const seconds = z.number().finite().nonnegative()
const coordinate = z.number().min(0).max(1)
const feedbackSchema = z
  .object({
    kind: z.literal('video_feedback'),
    id: z.string().uuid(),
    filePath: z.string().min(1),
    version: z.string().min(1),
    versionPath: z.string().optional(),
    timeSeconds: seconds,
    range: z
      .object({ startSeconds: seconds, endSeconds: seconds })
      .refine((range) => range.endSeconds > range.startSeconds)
      .optional(),
    screenshotPath: z.string().min(1),
    screenshotSize: z.object({
      width: z.number().int().positive(),
      height: z.number().int().positive(),
      sizeBytes: z.number().int().positive()
    }),
    frameText: z.string().optional(),
    annotations: z.array(
      z.object({
        number: z.number().int().positive(),
        kind: z.enum(['rectangle', 'arrow']),
        text: z.string().trim().min(1)
      })
    ),
    geometry: z
      .array(
        z.object({
          number: z.number().int().positive(),
          kind: z.enum(['rectangle', 'arrow']),
          x1: coordinate,
          y1: coordinate,
          x2: coordinate,
          y2: coordinate
        })
      )
      .optional()
  })
  .strict()
  .refine(
    (node) => !!node.frameText?.trim() || node.annotations.length > 0,
    'Video feedback requires an opinion'
  )

export const validateVideoFeedback = async (
  node: VideoFeedbackNode,
  partnerId: string
): Promise<void> => {
  feedbackSchema.parse(node)
  if (!path.isAbsolute(node.filePath) || !path.isAbsolute(node.screenshotPath))
    throw new Error('视频引用路径无效')
  const screenshot = await fs.realpath(node.screenshotPath),
    root = await fs.realpath(getPartnerAssetsRootDir(partnerId))
  if (!screenshot.startsWith(root + path.sep)) throw new Error('视频截图不属于当前伙伴')
  if (node.versionPath) {
    const versionPath = await fs.realpath(node.versionPath)
    if (
      !versionPath.startsWith(root + path.sep) ||
      !path.basename(path.dirname(versionPath)).startsWith('video-reference-') ||
      !(await fs.stat(versionPath)).isFile()
    )
      throw new Error('视频版本不属于当前伙伴')
  }
  const bytes = await fs.readFile(screenshot)
  const image = await loadImage(bytes)
  node.screenshotSize = { width: image.width, height: image.height, sizeBytes: bytes.length }
  if (new Set(node.annotations.map((item) => item.number)).size !== node.annotations.length)
    throw new Error('视频意见编号重复')
}
