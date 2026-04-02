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
        label:
          | 'auto'
          | 'completions:jsonSchema'
          | 'completions:jsonMode'
          | 'completions:promptJson'
          | 'responses:jsonSchema'
          | 'responses:promptJson'
        preferredProfile?:
          | 'completions:jsonSchema'
          | 'completions:jsonMode'
          | 'completions:promptJson'
          | 'responses:jsonSchema'
          | 'responses:promptJson'
      }> = [
        { label: 'auto' },
        {
          label: 'completions:jsonSchema',
          preferredProfile: 'completions:jsonSchema'
        },
        {
          label: 'completions:jsonMode',
          preferredProfile: 'completions:jsonMode'
        },
        {
          label: 'completions:promptJson',
          preferredProfile: 'completions:promptJson'
        },
        {
          label: 'responses:jsonSchema',
          preferredProfile: 'responses:jsonSchema'
        },
        {
          label: 'responses:promptJson',
          preferredProfile: 'responses:promptJson'
        }
      ]

      const results: Array<Record<string, unknown>> = []

      for (const probeCase of probeCases) {
        try {
          const result = await invokeStructuredChat({
            caller: `live.probe.${probeCase.label}`,
            cfg,
            preferredProfile: probeCase.preferredProfile,
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
            transport: result.transport,
            method: result.method,
            profile: result.profile,
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

      expect(results).toHaveLength(6)
    },
    180_000
  )
})
