import type { JsonObject } from '../../../../../shared/types'
import { RUNTIME_SKILL_IDS } from '../constants'
import type {
  RuntimeSkillId,
  SkillCatalogItem,
  SkillDefinition,
  ToolPromptSpec
} from '../types'
import { CATALOG_TOOL_CONTRACTS, getCatalogSkillDefinition } from './catalog'
import type {
  AiToolFamilyId,
  ToolContractDefinition,
  ToolDescriptor
} from './types'

const TOOL_CONTRACTS = CATALOG_TOOL_CONTRACTS
type ToolContract = (typeof TOOL_CONTRACTS)[number]
type ToolContractName = ToolContract['name']

const cloneJsonObject = (value: JsonObject): JsonObject => ({ ...value })

const cloneToolPromptSpec = (spec: ToolPromptSpec): ToolPromptSpec => ({
  ...spec,
  preconditions: spec.preconditions ? [...spec.preconditions] : undefined,
  args: spec.args.map((item) => ({
    ...item,
    enumValues: item.enumValues ? [...item.enumValues] : undefined
  })),
  returns: spec.returns.map((item) => ({ ...item })),
  commonMistakes: spec.commonMistakes ? [...spec.commonMistakes] : undefined,
  examples: spec.examples
    ? spec.examples.map((item) => ({
        goal: item.goal,
        args: cloneJsonObject(item.args)
      }))
    : undefined
})

const toToolDescriptor = (contract: ToolContract): ToolDescriptor => ({
  name: contract.name,
  familyId: contract.familyId,
  skillIds: [...contract.skillIds],
  requiresWorkspace: contract.requiresWorkspace,
  promptSpec: contract.promptSpec,
  resolveExecutionMeta: contract.resolveExecutionMeta
})

export const TOOL_CATALOG: readonly ToolDescriptor[] = TOOL_CONTRACTS.map(toToolDescriptor)

const TOOL_CONTRACT_BY_NAME = new Map<ToolContractName, ToolContract>()
const TOOL_DESCRIPTOR_BY_NAME = new Map<string, ToolDescriptor>()
const TOOL_CONTRACTS_BY_FAMILY = new Map<AiToolFamilyId, ToolContractDefinition[]>()
const TOOL_DESCRIPTORS_BY_FAMILY = new Map<AiToolFamilyId, ToolDescriptor[]>()
const TOOL_CONTRACTS_BY_SKILL = new Map<RuntimeSkillId, ToolContractDefinition[]>()
const TOOL_DESCRIPTORS_BY_SKILL = new Map<RuntimeSkillId, ToolDescriptor[]>()

TOOL_CONTRACTS.forEach((contract, index) => {
  const descriptor = TOOL_CATALOG[index]

  TOOL_CONTRACT_BY_NAME.set(contract.name, contract)
  TOOL_DESCRIPTOR_BY_NAME.set(contract.name, descriptor)

  const familyContracts = TOOL_CONTRACTS_BY_FAMILY.get(contract.familyId) || []
  familyContracts.push(contract)
  TOOL_CONTRACTS_BY_FAMILY.set(contract.familyId, familyContracts)

  const familyDescriptors = TOOL_DESCRIPTORS_BY_FAMILY.get(contract.familyId) || []
  familyDescriptors.push(descriptor)
  TOOL_DESCRIPTORS_BY_FAMILY.set(contract.familyId, familyDescriptors)

  contract.skillIds.forEach((skillId) => {
    const skillContracts = TOOL_CONTRACTS_BY_SKILL.get(skillId) || []
    skillContracts.push(contract)
    TOOL_CONTRACTS_BY_SKILL.set(skillId, skillContracts)

    const skillDescriptors = TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || []
    skillDescriptors.push(descriptor)
    TOOL_DESCRIPTORS_BY_SKILL.set(skillId, skillDescriptors)
  })
})

const buildRuntimeSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => {
  const contracts = TOOL_CONTRACTS_BY_SKILL.get(skillId) || []
  if (contracts.length === 0) {
    throw new Error(`tool catalog has no tools bound for skill ${skillId}`)
  }

  const familyIds = Array.from(new Set(contracts.map((contract) => contract.familyId)))
  if (familyIds.length !== 1) {
    throw new Error(`skill ${skillId} must bind tools from exactly one family`)
  }

  const metadata = getCatalogSkillDefinition(skillId)
  return {
    skillId,
    familyId: familyIds[0],
    title: metadata.title,
    summary: metadata.summary,
    toolNames: contracts.map((contract) => contract.name),
    whenToUse: metadata.whenToUse,
    detail: metadata.detail
  }
}

const SKILL_DEFINITION_BY_ID = new Map<RuntimeSkillId, SkillDefinition>(
  RUNTIME_SKILL_IDS.map((skillId) => [skillId, buildRuntimeSkillDefinition(skillId)])
)

export function getToolContract<TName extends ToolContractName>(
  toolName: TName
): Extract<ToolContract, { name: TName }> | undefined
export function getToolContract(toolName: string): ToolContractDefinition | undefined
export function getToolContract(toolName: string): ToolContractDefinition | undefined {
  return TOOL_CONTRACT_BY_NAME.get(toolName as ToolContractName)
}

export const listToolContracts = (): ToolContractDefinition[] => [...TOOL_CONTRACTS]

export const listToolContractsByFamily = (
  familyId: AiToolFamilyId
): ToolContractDefinition[] => [...(TOOL_CONTRACTS_BY_FAMILY.get(familyId) || [])]

export const listToolContractsBySkill = (
  skillId: RuntimeSkillId
): ToolContractDefinition[] => [...(TOOL_CONTRACTS_BY_SKILL.get(skillId) || [])]

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

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const contract = getToolContract(toolName)
  return contract ? cloneToolPromptSpec(contract.promptSpec) : null
}

export const getRuntimeSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => {
  const definition = SKILL_DEFINITION_BY_ID.get(skillId)
  if (!definition) {
    throw new Error(`missing runtime skill definition for ${skillId}`)
  }
  return definition
}

export const listRuntimeSkillDefinitions = (): SkillDefinition[] =>
  RUNTIME_SKILL_IDS.map((skillId) => getRuntimeSkillDefinition(skillId))

export const listRuntimeSkillCatalogItems = (): SkillCatalogItem[] =>
  listRuntimeSkillDefinitions().map((definition) => ({
    skillId: definition.skillId,
    familyId: definition.familyId,
    title: definition.title,
    summary: definition.summary,
    toolNames: [...definition.toolNames],
    whenToUse: definition.whenToUse
  }))
