import type { CapabilityToolDefinition } from '../factories'
import { createStaticCapabilityToolDefinition } from '../factories'
import { DOCX_TOOL_SPECS } from '../../docx/toolSpecs'

const toDocxToolDefinition = (
  spec: (typeof DOCX_TOOL_SPECS)[number]
): CapabilityToolDefinition =>
  createStaticCapabilityToolDefinition({
    name: spec.name,
    familyId: 'docx',
    skillIds: [...spec.skillIds],
    requiresWorkspace: true,
    schema: spec.schema as CapabilityToolDefinition['schema'],
    promptSpec: spec.promptSpec,
    executionMeta: spec.executionMeta
  })

export const DOCX_TOOL_DEFINITIONS = DOCX_TOOL_SPECS.map(toDocxToolDefinition)
