import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const LLM_RECOGNIZE_SCHEMA = z.object({
  path: z.string().min(1),
  instruction: z.string().min(1)
})

export const LLM_RECOGNIZE_OUTPUT_SCHEMA = z.union([
  z.string().min(1),
  z.object({
    error: z.string()
  })
])

export const LLM_RECOGNIZE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LLM_RECOGNIZE_SCHEMA>,
  z.infer<typeof LLM_RECOGNIZE_OUTPUT_SCHEMA>,
  'llm_recognize',
  'image-recognition'
> = {
  name: 'llm_recognize',
  familyId: 'image-recognition',
  skillIds: ['image-recognition'],
  requiresWorkspace: true,
  inputSchema: LLM_RECOGNIZE_SCHEMA,
  outputSchema: LLM_RECOGNIZE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'llm_recognize',
    description:
      '能力：读取指定图片路径，并按 instruction 让大模型理解图片内容。\n结果：直接返回模型输出的普通文本。\n边界：instruction 必填；如果模型无法识别,则要停止识别相关任务,继续其他的,禁止继续尝试识别图片。',
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

export const IMAGE_RECOGNITION_TOOL_SPECS = [LLM_RECOGNIZE_TOOL_SPEC] as const
