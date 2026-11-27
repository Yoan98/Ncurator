import type { HumanToolSpec } from '../types'
import { drawingSchema, type DrawingInput } from './toolSchemas'
import { createStaticExecutionMetaResolver, readStringArg } from '../utils/toolSpecUtils'

export const DRAWING_TOOL_SPEC: HumanToolSpec<DrawingInput, 'drawing', 'drawing'> = {
  name: 'drawing',
  familyId: 'drawing',
  toolsetIds: ['drawing'],
  inputSchema: drawingSchema,
  promptSpec: {
    name: 'drawing',
    description: '根据自然语言和本地参考素材制作或修改图片、动画，保留可编辑来源。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    getResourceKey: (args) => readStringArg(args, 'outputPath'),
    defaultResourceKey: 'drawing'
  }),
  modelResult: {
    renderSuccess: ({ args, data }) =>
      `已生成：${args.outputPath}\n可编辑来源：${data && typeof data === 'object' && !Array.isArray(data) ? data.sourcePath : ''}`
  }
}
export const DRAWING_TOOL_SPECS = [DRAWING_TOOL_SPEC] as const
