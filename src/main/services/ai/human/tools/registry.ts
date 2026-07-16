import { DOCX_TOOL_SPECS } from './docx/toolSpecs'
import { IMAGE_RECOGNITION_TOOL_SPECS } from './imageRecognition/toolSpecs'
import { KB_TOOL_SPECS } from './kb/toolSpecs'
import { PDF_TOOL_SPECS } from './pdf/toolSpecs'
import { UTILITY_TOOL_SPECS } from './utility/toolSpecs'
import { WEB_TOOL_SPECS } from './web/toolSpecs'
import {
  createTerminalRunToolSpec,
  TERMINAL_RUN_TOOL_SPEC,
  TERMINAL_TOOL_SPECS
} from './terminal/toolSpecs'
import { TEXT_FILE_TOOL_SPECS } from './textFile/toolSpecs'
import type { AiToolFamilyId, HumanToolSpec } from './types'
import type { AiRuntimePlatform } from '../../types'

export const ALL_TOOL_SPECS = [
  ...TERMINAL_TOOL_SPECS,
  ...TEXT_FILE_TOOL_SPECS,
  ...KB_TOOL_SPECS,
  ...DOCX_TOOL_SPECS,
  ...PDF_TOOL_SPECS,
  ...WEB_TOOL_SPECS,
  ...UTILITY_TOOL_SPECS,
  ...IMAGE_RECOGNITION_TOOL_SPECS
] as const

type AnyToolSpec = (typeof ALL_TOOL_SPECS)[number]

const TOOL_SPEC_BY_NAME = new Map<string, AnyToolSpec>(
  ALL_TOOL_SPECS.map((spec) => [spec.name, spec])
)
const TOOL_SPECS_BY_FAMILY = new Map<AiToolFamilyId, AnyToolSpec[]>()

for (const spec of ALL_TOOL_SPECS) {
  const existing = TOOL_SPECS_BY_FAMILY.get(spec.familyId) || []
  existing.push(spec)
  TOOL_SPECS_BY_FAMILY.set(spec.familyId, existing)
}

export function getToolSpec<TName extends AnyToolSpec['name']>(
  toolName: TName,
  platform?: AiRuntimePlatform
): Extract<AnyToolSpec, { name: TName }> | undefined
export function getToolSpec(
  toolName: string,
  platform?: AiRuntimePlatform
): HumanToolSpec | undefined
export function getToolSpec(
  toolName: string,
  platform?: AiRuntimePlatform
): HumanToolSpec | undefined {
  if (toolName === TERMINAL_RUN_TOOL_SPEC.name) {
    return createTerminalRunToolSpec(platform)
  }
  return TOOL_SPEC_BY_NAME.get(toolName)
}

export const listAllToolNames = (): string[] => [...TOOL_SPEC_BY_NAME.keys()]

export const listToolNamesByFamily = (familyId: AiToolFamilyId): string[] =>
  [...(TOOL_SPECS_BY_FAMILY.get(familyId) || [])].map((spec) => spec.name)

export const listToolSpecsByFamily = (familyId: AiToolFamilyId): HumanToolSpec[] => [
  ...(TOOL_SPECS_BY_FAMILY.get(familyId) || [])
]
