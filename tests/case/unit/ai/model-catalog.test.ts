import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchLlmRemoteModels } from '../../../../src/main/services/llm/modelCatalog'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('llm model catalog', () => {
  it('filters unavailable models and preserves modalities', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'shutdown-model',
              status: 'Shutdown'
            },
            {
              id: 'prompt-json-model',
              status: 'Running',
              features: {
                structured_outputs: {
                  json_schema: false,
                  json_object: false
                }
              },
              modalities: {
                input_modalities: ['text', 'image'],
                output_modalities: ['text']
              }
            }
          ]
        })
      })
    )

    const result = await fetchLlmRemoteModels({
      id: 'cfg-1',
      name: 'Provider',
      providerKind: 'openai-compatible',
      base_url: 'https://example.test/v1',
      api_key: 'test-key'
    })

    expect(result).toEqual({
      success: true,
      items: [
        {
          id: 'prompt-json-model',
          label: 'prompt-json-model',
          status: 'Running',
          inputModalities: ['text', 'image'],
          outputModalities: ['text']
        }
      ]
    })
  })
})
