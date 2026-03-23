import type { ToolPromptSpec } from '../types'
import type { JsonObject } from '../../../../../shared/types'
import { listToolDescriptors } from '../tools/toolCatalog'

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

const TOOL_PROMPT_SPECS: Record<string, ToolPromptSpec> = Object.fromEntries(
  listToolDescriptors().map((descriptor) => [descriptor.name, descriptor.promptSpec] as const)
)

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const matched = TOOL_PROMPT_SPECS[toolName]
  return matched ? cloneToolPromptSpec(matched) : null
}
