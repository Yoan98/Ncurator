import type {
  AiLlmDriver,
  AiLlmStructuredDriverResult,
  AiLlmTextDriverResult
} from '../../../src/main/services/ai/llmExecutor'
import type { AiLlmUsage, JsonObject } from '../../../src/shared/types'
import type { LlmScript, ScriptedLlmCall, ScriptedLlmStep } from './test-types'

const isErrorStep = (
  step: ScriptedLlmStep
): step is Extract<ScriptedLlmStep, { error: string }> =>
  typeof step === 'object' && step !== null && 'error' in step

const isObjectOutputStep = (
  step: ScriptedLlmStep
): step is Extract<ScriptedLlmStep, { output: JsonObject }> =>
  typeof step === 'object' && step !== null && 'output' in step

const isTextOutputStep = (
  step: ScriptedLlmStep
): step is Extract<ScriptedLlmStep, { text: string }> =>
  typeof step === 'object' && step !== null && 'text' in step

const isWaitForAbortStep = (
  step: ScriptedLlmStep
): step is Extract<ScriptedLlmStep, { waitForAbort: true }> =>
  typeof step === 'object' && step !== null && 'waitForAbort' in step

const isDelayedErrorStep = (
  step: ScriptedLlmStep
): step is Extract<ScriptedLlmStep, { waitMs: number; thenError: string }> =>
  typeof step === 'object' &&
  step !== null &&
  'waitMs' in step &&
  'thenError' in step

const estimateScriptedUsage = (input: {
  system: string
  user: string
  rawText: string
}): AiLlmUsage => ({
  inputTokens: Math.ceil(`${input.system}\n${input.user}`.length / 3),
  outputTokens: Math.ceil(input.rawText.length / 3),
  source: 'usage_metadata'
})

const toChunkList = (input: {
  rawText: string
  explicitChunks?: string[]
  streamingMode: 'force_stream' | 'force_non_stream'
}): string[] =>
  input.streamingMode === 'force_stream'
    ? input.explicitChunks && input.explicitChunks.length > 0
      ? [...input.explicitChunks]
      : input.rawText
        ? [input.rawText]
        : []
    : []

const emitChunks = (chunks: string[], onDelta?: (text: string) => void): void => {
  chunks.forEach((chunk) => {
    if (!chunk) return
    onDelta?.(chunk)
  })
}

const resolveTextFromObjectOutput = (output: JsonObject): string => {
  const deliveryMarkdown = String(output.deliveryMarkdown || '').trim()
  if (deliveryMarkdown) return deliveryMarkdown
  const text = String(output.text || '').trim()
  if (text) return text
  return JSON.stringify(output)
}

const resolveStructuredOutput = (value: JsonObject | string): JsonObject => {
  if (typeof value !== 'string') return value
  const parsed = JSON.parse(value) as JsonObject
  return parsed
}

export const createScriptedStructuredOutputDriver = (script: LlmScript): AiLlmDriver => {
  const callIndexes = new Map<string, number>()

  const waitForAbort = async (input: {
    signal?: AbortSignal
    onAbortError?: string
  }): Promise<never> =>
    await new Promise<never>((_resolve, reject) => {
      const abort = () => {
        reject(new Error(input.onAbortError || 'scripted_wait_for_abort'))
      }
      if (input.signal?.aborted) {
        abort()
        return
      }
      input.signal?.addEventListener('abort', abort, { once: true })
    })

  const nextCall = (input: {
    caller: string
    schemaName: string
    system: string
    user: string
    mode: 'structured' | 'text'
  }): {
    payload: ScriptedLlmCall
    step: ScriptedLlmStep
  } => {
    const caller = String(input.caller || '').trim()
    const nextIndex = (callIndexes.get(caller) || 0) + 1
    callIndexes.set(caller, nextIndex)

    const steps = script[caller] || []
    const step = steps[nextIndex - 1]
    if (!step) {
      throw new Error(`scripted_llm_missing: caller=${caller}; callIndex=${nextIndex}`)
    }

    return {
      payload: {
        caller,
        schemaName: input.schemaName,
        system: input.system,
        user: input.user,
        callIndex: nextIndex,
        mode: input.mode
      },
      step
    }
  }

  return {
    chatStructured: async (input): Promise<AiLlmStructuredDriverResult> => {
      const { payload, step } = nextCall({
        caller: input.caller,
        schemaName: input.schemaName,
        system: input.system,
        user: input.user,
        mode: 'structured'
      })

      if (typeof step === 'function') {
        const resolved = resolveStructuredOutput(await step(payload))
        const rawText = JSON.stringify(resolved)
        emitChunks(
          toChunkList({
            rawText,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output: resolved,
          rawText,
          method: 'scripted',
          usage: estimateScriptedUsage({
            system: input.system,
            user: input.user,
            rawText
          }),
          streamed: input.streamingMode === 'force_stream'
        }
      }

      if (isErrorStep(step)) {
        throw new Error(step.error)
      }

      if (isWaitForAbortStep(step)) {
        return await waitForAbort({
          signal: input.signal,
          onAbortError: step.onAbortError
        })
      }

      if (isDelayedErrorStep(step)) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs))
        throw new Error(step.thenError)
      }

      if (isObjectOutputStep(step)) {
        const rawText = JSON.stringify(step.output)
        emitChunks(
          toChunkList({
            rawText,
            explicitChunks: step.chunks,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output: step.output,
          rawText,
          method: 'scripted',
          usage: step.usage || estimateScriptedUsage({
            system: input.system,
            user: input.user,
            rawText
          }),
          streamed: input.streamingMode === 'force_stream'
        }
      }

      if (isTextOutputStep(step)) {
        const resolved = resolveStructuredOutput(step.text)
        emitChunks(
          toChunkList({
            rawText: step.text,
            explicitChunks: step.chunks,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output: resolved,
          rawText: step.text,
          method: 'scripted',
          usage: step.usage || estimateScriptedUsage({
            system: input.system,
            user: input.user,
            rawText: step.text
          }),
          streamed: input.streamingMode === 'force_stream'
        }
      }

      throw new Error(`invalid scripted structured step: caller=${payload.caller}; callIndex=${payload.callIndex}`)
    },

    chatText: async (input): Promise<AiLlmTextDriverResult> => {
      const { payload, step } = nextCall({
        caller: input.caller,
        schemaName: input.schemaName,
        system: input.system,
        user: input.user,
        mode: 'text'
      })

      if (typeof step === 'function') {
        const resolved = await step(payload)
        const output = typeof resolved === 'string' ? resolved : resolveTextFromObjectOutput(resolved)
        emitChunks(
          toChunkList({
            rawText: output,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output,
          rawText: output,
          streamed: input.streamingMode === 'force_stream'
        }
      }

      if (isErrorStep(step)) {
        throw new Error(step.error)
      }

      if (isWaitForAbortStep(step)) {
        return await waitForAbort({
          signal: input.signal,
          onAbortError: step.onAbortError
        })
      }

      if (isDelayedErrorStep(step)) {
        await new Promise((resolve) => setTimeout(resolve, step.waitMs))
        throw new Error(step.thenError)
      }

      if (isTextOutputStep(step)) {
        emitChunks(
          toChunkList({
            rawText: step.text,
            explicitChunks: step.chunks,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output: step.text,
          rawText: step.text,
          streamed: input.streamingMode === 'force_stream'
        }
      }

      if (isObjectOutputStep(step)) {
        const output = resolveTextFromObjectOutput(step.output)
        emitChunks(
          toChunkList({
            rawText: output,
            explicitChunks: step.chunks,
            streamingMode: input.streamingMode
          }),
          input.observer?.onDelta
        )
        return {
          output,
          rawText: output,
          streamed: input.streamingMode === 'force_stream'
        }
      }

      throw new Error(`invalid scripted text step: caller=${payload.caller}; callIndex=${payload.callIndex}`)
    }
  }
}
