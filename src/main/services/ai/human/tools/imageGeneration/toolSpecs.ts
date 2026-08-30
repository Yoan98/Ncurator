import type { z } from 'zod/v4'
import type { HumanToolSpec } from '../types'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'
import { renderImageGenerateModelResult } from '../../shared/modelToolResultRenderers'
import { imageGenerateOutputSchema, imageGenerateSchema } from './toolSchemas'

export const IMAGE_GENERATE_TOOL_SPEC: HumanToolSpec<
  z.infer<typeof imageGenerateSchema>,
  z.infer<typeof imageGenerateOutputSchema>,
  'image_generate',
  'image-generation'
> = {
  name: 'image_generate',
  familyId: 'image-generation',
  skillIds: ['image-generation'],
  inputSchema: imageGenerateSchema,
  outputSchema: imageGenerateOutputSchema,
  promptSpec: {
    name: 'image_generate',
    description: '将 SVG 内容渲染为图片并保存到工作区。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'outputPath'),
    defaultResourceKey: 'image'
  }),
  modelResult: { renderSuccess: renderImageGenerateModelResult }
}

export const IMAGE_GENERATION_TOOL_SPECS = [IMAGE_GENERATE_TOOL_SPEC] as const
