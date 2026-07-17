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
      '能力：读取指定图片，并按 instruction 让大模型分析图片内容。\n结果：返回图片分析文本，无法识别时返回 error。',
    whenToUse: '适用于你已经有图片路径，并且需要按当前任务自己决定怎么向模型询问图片内容的情况。',
    examples: [
      {
        goal: '识别截图里主要展示了什么',
        args: {
          path: '/workspace/.ncurator/runtime/assets/session-1/screen.png',
          instruction: '请概括这张截图的主要内容，并指出用户接下来最可能要做的操作。'
        }
      }
    ]
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'image'
  })
}

export const IMAGE_RECOGNITION_TOOL_SPECS = [IMAGE_ANALYZE_TOOL_SPEC] as const
