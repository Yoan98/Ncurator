import type { RuntimeSkillId } from '../types'
import type { AiToolFamilyId, ToolDescriptor } from './types'
import { listCapabilityToolDefinitions } from './capabilityRegistry'

export const TOOL_CATALOG: readonly ToolDescriptor[] = listCapabilityToolDefinitions()

const TOOL_DESCRIPTOR_BY_NAME = new Map(
  TOOL_CATALOG.map((descriptor) => [descriptor.name, descriptor] as const)
)

const TOOL_DESCRIPTORS_BY_FAMILY = new Map<AiToolFamilyId, ToolDescriptor[]>()
const TOOL_DESCRIPTORS_BY_SKILL = new Map<RuntimeSkillId, ToolDescriptor[]>()

TOOL_CATALOG.forEach((descriptor) => {
  const familyDescriptors = TOOL_DESCRIPTORS_BY_FAMILY.get(descriptor.familyId) || []
  familyDescriptors.push(descriptor)
  TOOL_DESCRIPTORS_BY_FAMILY.set(descriptor.familyId, familyDescriptors)

  descriptor.skillIds.forEach((skillId) => {
    const skillDescriptors = TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || []
    skillDescriptors.push(descriptor)
    TOOL_DESCRIPTORS_BY_SKILL.set(skillId, skillDescriptors)
  })
})

export const getToolDescriptor = (toolName: string): ToolDescriptor | undefined =>
  TOOL_DESCRIPTOR_BY_NAME.get(toolName)

export const listToolDescriptors = (): ToolDescriptor[] => [...TOOL_CATALOG]

export const listToolDescriptorsByFamily = (familyId: AiToolFamilyId): ToolDescriptor[] =>
  [...(TOOL_DESCRIPTORS_BY_FAMILY.get(familyId) || [])]

export const listToolNamesByFamily = (familyId: AiToolFamilyId): string[] =>
  listToolDescriptorsByFamily(familyId).map((descriptor) => descriptor.name)

export const listToolDescriptorsBySkill = (skillId: RuntimeSkillId): ToolDescriptor[] =>
  [...(TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || [])]

export const listToolNamesBySkill = (skillId: RuntimeSkillId): string[] =>
  listToolDescriptorsBySkill(skillId).map((descriptor) => descriptor.name)
