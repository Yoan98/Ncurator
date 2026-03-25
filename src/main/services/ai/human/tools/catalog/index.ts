import type { JsonObject } from '../../../../../../shared/types'
import { RUNTIME_SKILL_IDS } from '../../constants'
import type {
  RuntimeSkillId,
  SkillCatalogItem,
  SkillDefinition,
  ToolPromptSpec
} from '../../types'
import type { CapabilityToolDefinition, CatalogSkillMetadata } from './factories'
import { CATALOG_SKILL_DEFINITIONS } from './skillDefinitions'
import { DOCX_TOOL_DEFINITIONS } from '../docx/toolSpecs'
import { KB_TOOL_DEFINITIONS } from './toolDescriptors/kb'
import { TERMINAL_TOOL_DEFINITIONS } from './toolDescriptors/terminal'
import type {
  AiToolFamilyId,
  ToolContractDefinition,
  ToolDescriptor
} from '../types'

export const SKILL_DEFINITIONS: Record<RuntimeSkillId, CatalogSkillMetadata> =
  CATALOG_SKILL_DEFINITIONS

export const CATALOG_TOOL_CONTRACT_SETS = {
  terminal: TERMINAL_TOOL_DEFINITIONS,
  kb: KB_TOOL_DEFINITIONS,
  docx: DOCX_TOOL_DEFINITIONS
} as const

export const CATALOG_TOOL_CONTRACTS = [
  ...CATALOG_TOOL_CONTRACT_SETS.terminal,
  ...CATALOG_TOOL_CONTRACT_SETS.kb,
  ...CATALOG_TOOL_CONTRACT_SETS.docx
] as const

type ToolContract = (typeof CATALOG_TOOL_CONTRACTS)[number]
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

export const TOOL_CATALOG: readonly ToolDescriptor[] = CATALOG_TOOL_CONTRACTS.map(toToolDescriptor)

const TOOL_CONTRACT_BY_NAME = new Map<ToolContractName, ToolContract>()
const TOOL_DESCRIPTOR_BY_NAME = new Map<string, ToolDescriptor>()
const TOOL_CONTRACTS_BY_FAMILY = new Map<AiToolFamilyId, ToolContractDefinition[]>()
const TOOL_DESCRIPTORS_BY_FAMILY = new Map<AiToolFamilyId, ToolDescriptor[]>()
const TOOL_CONTRACTS_BY_SKILL = new Map<RuntimeSkillId, ToolContractDefinition[]>()
const TOOL_DESCRIPTORS_BY_SKILL = new Map<RuntimeSkillId, ToolDescriptor[]>()

const registerToolContractGroup = <TKey, TValue>(
  target: Map<TKey, TValue[]>,
  key: TKey,
  value: TValue
) => {
  const items = target.get(key) || []
  items.push(value)
  target.set(key, items)
}

const registerToolContract = (contract: ToolContract, descriptor: ToolDescriptor) => {
  TOOL_CONTRACT_BY_NAME.set(contract.name, contract)
  TOOL_DESCRIPTOR_BY_NAME.set(contract.name, descriptor)

  registerToolContractGroup(TOOL_CONTRACTS_BY_FAMILY, contract.familyId, contract)
  registerToolContractGroup(TOOL_DESCRIPTORS_BY_FAMILY, contract.familyId, descriptor)

  contract.skillIds.forEach((skillId) => {
    registerToolContractGroup(TOOL_CONTRACTS_BY_SKILL, skillId, contract)
    registerToolContractGroup(TOOL_DESCRIPTORS_BY_SKILL, skillId, descriptor)
  })
}

CATALOG_TOOL_CONTRACTS.forEach((contract, index) => {
  registerToolContract(contract, TOOL_CATALOG[index])
})

const SKILL_DEFINITION_BY_ID = new Map<RuntimeSkillId, SkillDefinition>(
  RUNTIME_SKILL_IDS.map((skillId) => {
    const contracts = TOOL_CONTRACTS_BY_SKILL.get(skillId) || []
    if (contracts.length === 0) {
      throw new Error(`tool catalog has no tools bound for skill ${skillId}`)
    }

    const familyIds = Array.from(new Set(contracts.map((contract) => contract.familyId)))
    if (familyIds.length !== 1) {
      throw new Error(`skill ${skillId} must bind tools from exactly one family`)
    }

    const metadata = SKILL_DEFINITIONS[skillId]
    return [
      skillId,
      {
        ...metadata,
        familyId: familyIds[0],
        toolNames: contracts.map((contract) => contract.name)
      }
    ]
  })
)

export const getCatalogSkillDefinition = (
  skillId: RuntimeSkillId
): CatalogSkillMetadata => SKILL_DEFINITIONS[skillId]

export const listCatalogToolContracts = (): CapabilityToolDefinition[] => [...CATALOG_TOOL_CONTRACTS]

export const hasSkillDefinition = (skillId: string): skillId is RuntimeSkillId =>
  RUNTIME_SKILL_IDS.includes(skillId as RuntimeSkillId)

export const getSkillDefinition = (skillId: RuntimeSkillId): SkillDefinition => {
  const definition = SKILL_DEFINITION_BY_ID.get(skillId)
  if (!definition) {
    throw new Error(`missing runtime skill definition for ${skillId}`)
  }
  return definition
}

export const buildSkillCatalog = (): SkillCatalogItem[] =>
  RUNTIME_SKILL_IDS.map((skillId) => {
    const definition = getSkillDefinition(skillId)
    return {
      skillId: definition.skillId,
      familyId: definition.familyId,
      title: definition.title,
      summary: definition.summary,
      toolNames: [...definition.toolNames],
      whenToUse: definition.whenToUse
    }
  })

export function getToolContract<TName extends ToolContractName>(
  toolName: TName
): Extract<ToolContract, { name: TName }> | undefined
export function getToolContract(toolName: string): ToolContractDefinition | undefined
export function getToolContract(toolName: string): ToolContractDefinition | undefined {
  return TOOL_CONTRACT_BY_NAME.get(toolName as ToolContractName)
}

export const getToolDescriptor = (toolName: string): ToolDescriptor | undefined =>
  TOOL_DESCRIPTOR_BY_NAME.get(toolName)

export const listToolNamesByFamily = (familyId: AiToolFamilyId): string[] =>
  [...(TOOL_DESCRIPTORS_BY_FAMILY.get(familyId) || [])].map((descriptor) => descriptor.name)

export const listToolNamesBySkill = (skillId: RuntimeSkillId): string[] =>
  [...(TOOL_DESCRIPTORS_BY_SKILL.get(skillId) || [])].map((descriptor) => descriptor.name)

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const contract = getToolContract(toolName)
  return contract ? cloneToolPromptSpec(contract.promptSpec) : null
}
