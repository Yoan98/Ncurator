import type { JsonObject, JsonValue, ToolPromptSpec } from '../../../../../../shared/types'
import type { AiRunContext } from '../../../types'
import { buildHumanReasonPrompt } from '../../../prompts/human/reason'
import { buildAvailableSkillCards } from '../registry/skills'
import { getToolPromptSpec } from '../registry/toolPrompts'
import { getActiveToolNames } from '../shared/runtime'
import type { HumanRuntimeCache, HumanState } from '../shared/state'

const clipText = (value: string, maxChars = 240): string => {
  const text = String(value || '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

const toJsonText = (value: JsonValue | JsonObject | object, fallback = 'none'): string => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return fallback
  }
}

const serializeTrace = (state: HumanState): string => {
  if (state.trace.steps.length === 0) return 'none'
  return state.trace.steps
    .slice(-8)
    .map((step) =>
      [
        `step=${step.step}`,
        `action=${step.action}`,
        `summary=${clipText(step.summary)}`,
        `status=${step.resultStatus || 'none'}`
      ].join(' | ')
    )
    .join('\n')
}

const serializeActiveTools = (toolNames: string[]): string => {
  if (toolNames.length === 0) return 'none'
  const specs: ToolPromptSpec[] = toolNames
    .map((toolName) => getToolPromptSpec(toolName))
    .filter((item): item is ToolPromptSpec => item !== null)
  return specs.length > 0 ? toJsonText(specs) : 'none'
}

const serializeAvailableSkills = (): string => {
  return toJsonText(buildAvailableSkillCards())
}

export const buildReasonPromptContext = (input: {
  ctx: AiRunContext
  cache: HumanRuntimeCache
  state: HumanState
  watchdogHintText: string
}) => {
  const activeToolNames = getActiveToolNames({
    state: input.state,
    cache: input.cache
  })

  return buildHumanReasonPrompt({
    objective: input.state.task.objective,
    selectedScopeSummary: input.ctx.selectedScopeSummary,
    availableSkillCardsText: serializeAvailableSkills(),
    activeToolsText: serializeActiveTools(activeToolNames),
    memoryText: toJsonText(input.state.memory),
    incomingText: input.state.turn.incoming ? toJsonText(input.state.turn.incoming) : 'none',
    traceText: serializeTrace(input.state),
    watchdogText: input.watchdogHintText
  })
}
