import type {
  StructuredOutputDriver,
  StructuredOutputDriverResult
} from '../../../src/main/services/ai/structuredOutput'
import type { JsonObject } from '../../../src/shared/types'
import type {
  ScriptedStructuredOutputCall,
  ScriptedStructuredOutputStep,
  StructuredOutputScript
} from './test-types'

const isErrorStep = (
  step: ScriptedStructuredOutputStep
): step is Extract<ScriptedStructuredOutputStep, { error: string }> =>
  typeof step === 'object' && step !== null && 'error' in step

const isOutputStep = (
  step: ScriptedStructuredOutputStep
): step is { output: JsonObject } =>
  typeof step === 'object' && step !== null && 'output' in step

export const createScriptedStructuredOutputDriver = (
  script: StructuredOutputScript
): StructuredOutputDriver => {
  const callIndexes = new Map<string, number>()

  return async (input) => {
    const caller = String(input.caller || '').trim()
    const nextIndex = (callIndexes.get(caller) || 0) + 1
    callIndexes.set(caller, nextIndex)

    const steps = script[caller] || []
    const step = steps[nextIndex - 1]
    if (!step) {
      throw new Error(
        `scripted_structured_output_missing: caller=${caller}; callIndex=${nextIndex}`
      )
    }

    const payload: ScriptedStructuredOutputCall = {
      caller,
      schemaName: input.schemaName,
      system: input.system,
      user: input.user,
      callIndex: nextIndex
    }

    if (typeof step === 'function') {
      return {
        output: await step(payload),
        method: 'scripted',
        fallbackChain: ['scripted']
      } satisfies StructuredOutputDriverResult
    }

    if (isErrorStep(step)) {
      throw new Error(step.error)
    }

    if (isOutputStep(step)) {
      return {
        output: step.output,
        method: 'scripted',
        fallbackChain: ['scripted']
      } satisfies StructuredOutputDriverResult
    }

    throw new Error(`invalid scripted structured output step: caller=${caller}; callIndex=${nextIndex}`)
  }
}
