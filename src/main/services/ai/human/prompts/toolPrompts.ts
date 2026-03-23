import type { ToolPromptSpec } from '../types'
import type { JsonObject } from '../../../../../shared/types'
import { DOCX_TOOL_PROMPT_SPECS } from './toolPromptSpecs/docx'
import { KB_TOOL_PROMPT_SPECS } from './toolPromptSpecs/kb'
import { TERMINAL_TOOL_PROMPT_SPECS } from './toolPromptSpecs/terminal'

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

const TOOL_PROMPT_SPECS: Record<string, ToolPromptSpec> = {
  ...TERMINAL_TOOL_PROMPT_SPECS,
  ...DOCX_TOOL_PROMPT_SPECS,
  ...KB_TOOL_PROMPT_SPECS
}

export const getToolPromptSpec = (toolName: string): ToolPromptSpec | null => {
  const matched = TOOL_PROMPT_SPECS[toolName]
  return matched ? cloneToolPromptSpec(matched) : null
}
