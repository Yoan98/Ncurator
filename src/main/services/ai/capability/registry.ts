import type { AiTaskKind } from '../../../../shared/types'
import type { AiRunContext } from '../types'
import type { CapabilityToolRegistry } from './types'
import { localKbRetrievalCapability } from './local_kb_retrieval'
import { terminalExecCapability } from './terminal_exec'
import { docxCapability } from './docx'

export const buildCapabilityToolRegistry = (input: {
  ctx: AiRunContext
  runId: string
  taskId: string
}): CapabilityToolRegistry => {
  // 代码层按 capability 分组维护，运行时统一平铺为一个工具集合。
  const families = [localKbRetrievalCapability, terminalExecCapability, docxCapability]
  const builtFamilies = families.map((family) => ({
    family,
    tools: family.buildTools({
      ctx: input.ctx,
      runId: input.runId,
      taskId: input.taskId
    })
  }))
  const allTools = builtFamilies.flatMap((item) => item.tools)

  const toolToCapability: Record<string, AiTaskKind> = {}
  for (const item of builtFamilies) {
    for (const toolItem of item.tools) {
      toolToCapability[String(toolItem.name || '')] = item.family.capability
    }
  }

  return {
    families,
    allTools,
    toolToCapability
  }
}
