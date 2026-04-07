import { describe, expect, it } from 'vitest'
import { createAiLlmExecutor } from '../../../src/main/services/ai/llmExecutor'
import type { AiRunEvent, LLMConfig } from '../../../src/shared/types'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../harness/backend/llmConfig'

describe('ai unit text output live probe', () => {
  it(
    'probes production text executor in both non-stream and stream modes',
    async () => {
      if (!hasLiveLlmConfigInEnv('primary')) {
        expect(true).toBe(true)
        return
      }

      const cfg = loadLiveLlmConfigFromEnv('primary') as LLMConfig
      const probeModes = ['force_non_stream', 'force_stream'] as const
      const results: Array<Record<string, unknown>> = []

      for (const streamingMode of probeModes) {
        const events: AiRunEvent[] = []
        const executor = createAiLlmExecutor({
          eventCtx: {
            runId: `live-text-probe-${streamingMode}`,
            sendEvent: (event) => events.push(event)
          },
          runtimeSettings: {
            llmStreamingMode: streamingMode
          },
          getConfig: async () => cfg,
          saveConfig: async () => undefined,
          checkCancelled: () => undefined
        })

        try {
          const output = await executor.chatText({
            caller: `live.text.${streamingMode}`,
            schemaName: 'live_text_answer',
            system: 'You are a transport compatibility probe. Reply with exactly "ok".',
            user: 'Reply with exactly ok.',
            temperature: 0
          })

          results.push({
            streamingMode,
            ok: true,
            output,
            llmStreamDeltaCount: events.filter((event) => event.type === 'llm_stream_delta').length
          })
        } catch (error) {
          results.push({
            streamingMode,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      process.stdout.write(
        `${JSON.stringify({ baseUrl: cfg.base_url, model: cfg.model_name, results }, null, 2)}\n`
      )

      expect(results).toHaveLength(2)
    },
    180_000
  )
})
