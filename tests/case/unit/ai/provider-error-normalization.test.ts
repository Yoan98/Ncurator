import { describe, expect, it } from 'vitest'
import { normalizeStructuredOutputError } from '../../../../src/main/services/ai/structuredOutput'

describe('provider error normalization', () => {
  it('removes SDK troubleshooting links from the user-facing provider message', () => {
    const result = normalizeStructuredOutputError(
      Object.assign(
        new Error(
          '404 provider message\n\nTroubleshooting URL: https://docs.langchain.com/errors/MODEL_NOT_FOUND/'
        ),
        {
          status: 404,
          code: 'ModelNotOpen'
        }
      )
    )

    expect(result).toMatchObject({
      status: 404,
      code: 'ModelNotOpen',
      message: '404 provider message'
    })
    expect(result.rawText).not.toContain('Troubleshooting URL')
    expect(result.rawText).not.toContain('langchain.com')
  })
})
