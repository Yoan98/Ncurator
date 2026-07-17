import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const IMAGE_ANALYZE_SCHEMA = z.object({
  path: z.string().min(1),
  instruction: z.string().min(1)
})

export const IMAGE_ANALYZE_OUTPUT_SCHEMA = z.union([
  z.string().min(1),
  z.object({
    error: z.string()
  })
])

export const IMAGE_ANALYZE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof IMAGE_ANALYZE_SCHEMA>,
  z.infer<typeof IMAGE_ANALYZE_OUTPUT_SCHEMA>,
  'image_analyze',
  'image-recognition'
> = {
  name: 'image_analyze',
  familyId: 'image-recognition',
  skillIds: ['image-recognition'],
  requiresWorkspace: true,
  inputSchema: IMAGE_ANALYZE_SCHEMA,
  outputSchema: IMAGE_ANALYZE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'image_analyze',
    description:
      '读取指定图片，并按 instruction 让大模型分析图片内容。\n结果：返回图片分析文本，无法识别时返回 error。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'image'
  })
}

export const IMAGE_RECOGNITION_TOOL_SPECS = [IMAGE_ANALYZE_TOOL_SPEC] as const
