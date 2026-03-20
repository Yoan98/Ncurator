import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../types'

export type AiToolCapability = 'local_kb_retrieval' | 'terminal_exec' | 'docx'

export type CapabilityToolBuildInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
}

export type CapabilityToolBuilder = (
  input: CapabilityToolBuildInput
) => StructuredToolInterface[]

export type CapabilityToolFamily = {
  capability: AiToolCapability
  buildTools: CapabilityToolBuilder
}

export type CapabilityToolRegistry = {
  families: CapabilityToolFamily[]
  allTools: StructuredToolInterface[]
  toolToCapability: Record<string, AiToolCapability>
}
