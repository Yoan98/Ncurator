import { describe, expect, it } from 'vitest'
import { z } from 'zod/v4'
import { invokeStructuredChat } from '../../../src/main/services/ai/structuredOutput'
import {
  hasLiveLlmConfigInEnv,
  loadLiveLlmConfigFromEnv
} from '../../harness/backend/llmConfig'

const schema = z.object({
  answer: z.string()
})

describe('ai unit structured output live probe', () => {
  it(
    'probes production structured output wrapper against the current primary live model',
    async () => {
      if (!hasLiveLlmConfigInEnv('primary')) {
        expect(true).toBe(true)
        return
      }

      const cfg = loadLiveLlmConfigFromEnv('primary')
      const probeCases: Array<{
        label: 'auto' | 'jsonSchema' | 'jsonMode' | 'promptJson'
        preferredMethod?: 'jsonSchema' | 'jsonMode' | 'promptJson'
      }> = [
        { label: 'auto' },
        { label: 'jsonSchema', preferredMethod: 'jsonSchema' },
        { label: 'jsonMode', preferredMethod: 'jsonMode' },
        { label: 'promptJson', preferredMethod: 'promptJson' }
      ]

      const results: Array<Record<string, unknown>> = []

      for (const probeCase of probeCases) {
        try {
          const result = await invokeStructuredChat({
            caller: `live.probe.${probeCase.label}`,
            cfg,
            preferredMethod: probeCase.preferredMethod,
            schema,
            schemaName: 'live_probe_answer',
            system:
              'You are a structured output compatibility probe. Return only valid JSON matching the schema.',
            user: 'Return a JSON object where answer is exactly "ok".',
            temperature: 0
          })

          results.push({
            case: probeCase.label,
            ok: true,
            method: result.method,
            fallbackChain: result.fallbackChain,
            output: result.output
          })
        } catch (error) {
          results.push({
            case: probeCase.label,
            ok: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      process.stdout.write(
        `${JSON.stringify({ baseUrl: cfg.base_url, model: cfg.model_name, results }, null, 2)}\n`
      )

      expect(results).toHaveLength(4)
    },
    180_000
  )
})
