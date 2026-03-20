import type { StructuredToolInterface } from '@langchain/core/tools'
import type { AiRunContext } from '../../types'
import type { RuntimeSkillId } from '../types'

export type AiToolFamilyId = 'terminal' | 'kb' | 'docx'

export type ToolFamilyBuildInput = {
  ctx: AiRunContext
  runId: string
  taskId: string
}

export type ToolFamilyBuilder = (input: ToolFamilyBuildInput) => StructuredToolInterface[]

export type ToolFamilyDefinition = {
  familyId: AiToolFamilyId
  buildTools: ToolFamilyBuilder
}

export type SkillToolBinding = {
  skillId: RuntimeSkillId
  familyId: AiToolFamilyId
  toolNames: string[]
}

export type ToolFamilyRegistry = {
  families: ToolFamilyDefinition[]
  allTools: StructuredToolInterface[]
  toolToFamily: Record<string, AiToolFamilyId>
}
