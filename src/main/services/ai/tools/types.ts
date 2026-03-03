import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiTaskKind } from '../../../../shared/types'
import type { AiRunContext } from '../types'

export type CapabilityToolBuildInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
}

export type CapabilityToolBuilder = (
  input: CapabilityToolBuildInput
) => StructuredToolInterface[]

export type CapabilityToolFamily = {
  capability: AiTaskKind
  buildTools: CapabilityToolBuilder
}

export type CapabilityToolRegistry = {
  families: CapabilityToolFamily[]
  allTools: StructuredToolInterface[]
  toolToCapability: Record<string, AiTaskKind>
}
