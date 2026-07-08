import { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const WAIT_TIME_SCHEMA = z.object({
  seconds: z.number().min(0).max(60)
})

export const WAIT_TIME_OUTPUT_SCHEMA = z.object({
  waitedMs: z.number().int()
})

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

export const WAIT_TIME_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof WAIT_TIME_SCHEMA>,
  z.infer<typeof WAIT_TIME_OUTPUT_SCHEMA>,
  'wait_time',
  'utility'
> = {
  name: 'wait_time',
  familyId: 'utility',
  skillIds: ['utility'],
  requiresWorkspace: false,
  inputSchema: WAIT_TIME_SCHEMA,
  outputSchema: WAIT_TIME_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'wait_time',
    description: '能力：等待指定秒数。\n结果：返回实际等待毫秒数。\n边界：不读取或修改内容。',
    whenToUse: '适用于任务需要等待页面或异步状态变化的情况。',
    examples: [
      {
        goal: '等待页面加载完成',
        args: {
          seconds: 2
        }
      }
    ]
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'read_only',
    defaultResourceKey: 'timer'
  })
}

export const LLM_RECOGNIZE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof LLM_RECOGNIZE_SCHEMA>,
  z.infer<typeof LLM_RECOGNIZE_OUTPUT_SCHEMA>,
  'llm_recognize',
  'image-recognition'
> = {
  name: 'llm_recognize',
  familyId: 'utility',
  skillIds: ['image-recognition'],
  requiresWorkspace: true,
  inputSchema: LLM_RECOGNIZE_SCHEMA,
  outputSchema: LLM_RECOGNIZE_OUTPUT_SCHEMA,
  promptSpec: {
    name: 'llm_recognize',
    description:
      '能力：读取指定图片路径，并按 instruction 让大模型理解图片内容。\n结果：直接返回模型输出的普通文本。\n边界：instruction 必填；只做图像理解，不做 OCR 专项结构化抽取。',
    whenToUse: '适用于你已经有图片路径，并且需要按当前任务自己决定怎么向模型询问图片内容的情况。',
    examples: [
      {
        goal: '识别截图里主要展示了什么',
        args: {
          path: '/workspace/.ncurator/assets/session-1/screen.png',
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

export const UTILITY_TOOL_SPECS = [WAIT_TIME_TOOL_SPEC, LLM_RECOGNIZE_TOOL_SPEC] as const
