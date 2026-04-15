import type { ToolPromptSpec } from '../types'
import { DOCX_TOOL_SPECS } from './docx/toolSpecs'
import { INTERNAL_TOOL_SPECS } from './internal/toolSpecs'
import { KB_TOOL_SPECS } from './kb/toolSpecs'
import { TERMINAL_TOOL_SPECS } from './terminal/toolSpecs'
import type { AiToolFamilyId, HumanToolSpec } from './types'

export const ALL_TOOL_SPECS = [
  ...TERMINAL_TOOL_SPECS,
  ...KB_TOOL_SPECS,
  ...DOCX_TOOL_SPECS,
  ...INTERNAL_TOOL_SPECS
] as const

type AnyToolSpec = (typeof ALL_TOOL_SPECS)[number]

const TOOL_SPEC_BY_NAME = new Map<string, AnyToolSpec>(ALL_TOOL_SPECS.map((spec) => [spec.name, spec]))
const TOOL_SPECS_BY_FAMILY = new Map<AiToolFamilyId, AnyToolSpec[]>()

for (const spec of ALL_TOOL_SPECS) {
  const existing = TOOL_SPECS_BY_FAMILY.get(spec.familyId) || []
  existing.push(spec)
  TOOL_SPECS_BY_FAMILY.set(spec.familyId, existing)
}

const cloneToolPromptSpec = (spec: ToolPromptSpec): ToolPromptSpec => ({
  ...spec,
  preconditions: spec.preconditions ? [...spec.preconditions] : undefined,
  args: spec.args.map((item) => ({
    ...item,
    enumValues: item.enumValues ? [...item.enumValues] : undefined
  })),
  returns: spec.returns.map((item) => ({ ...item })),
  examples: spec.examples.map((item) => ({
    goal: item.goal,
    args: structuredClone(item.args)
  }))
})

export function getToolSpec<TName extends AnyToolSpec['name']>(
  toolName: TName
): Extract<AnyToolSpec, { name: TName }> | undefined
export function getToolSpec(toolName: string): HumanToolSpec | undefined
export function getToolSpec(toolName: string): HumanToolSpec | undefined {
  return TOOL_SPEC_BY_NAME.get(toolName)
}

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const spec = TOOL_SPEC_BY_NAME.get(toolName)
  return spec ? cloneToolPromptSpec(spec.promptSpec) : null
}

export const listToolNamesByFamily = (familyId: AiToolFamilyId): string[] =>
  [...(TOOL_SPECS_BY_FAMILY.get(familyId) || [])].map((spec) => spec.name)

export const listToolSpecsByFamily = (familyId: AiToolFamilyId): HumanToolSpec[] =>
  [...(TOOL_SPECS_BY_FAMILY.get(familyId) || [])]
