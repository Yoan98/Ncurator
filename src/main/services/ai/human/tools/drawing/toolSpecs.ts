import type { HumanToolSpec } from '../types'
import { drawingSchema, type DrawingInput } from './toolSchemas'
import { createStaticExecutionMetaResolver } from '../utils/toolSpecUtils'

export const DRAWING_TOOL_SPEC: HumanToolSpec<DrawingInput, 'drawing', 'drawing'> = {
  name: 'drawing',
  familyId: 'drawing',
  toolsetIds: ['drawing'],
  inputSchema: drawingSchema,
  promptSpec: {
    name: 'drawing',
    description: '绘制静态画面和动画，支持基于已有绘画作品继续修改，保留可编辑场景。'
  },
  resolveExecutionMeta: createStaticExecutionMetaResolver({
    mutability: 'mutating',
    defaultResourceKey: 'drawing'
  }),
  modelResult: {
    renderSuccess: ({ data }) =>
      String(data && typeof data === 'object' && !Array.isArray(data) ? data.result || '' : '')
  }
}
export const DRAWING_TOOL_SPECS = [DRAWING_TOOL_SPEC] as const
