import type { AiRunContext } from './types'
import { buildMainGraph } from './graph/mainGraph'

export const buildAiRunGraph = (ctx: AiRunContext) => {
  return buildMainGraph({ ctx })
}
