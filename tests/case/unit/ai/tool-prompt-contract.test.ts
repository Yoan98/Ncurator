import { describe, expect, it } from 'vitest'
import { ALL_TOOL_SPECS } from '../../../../src/main/services/ai/human/tools/registry'

describe('ai unit tool prompt contract', () => {
  it('requires every declared tool example to match its schema', () => {
    const invalidExamples = ALL_TOOL_SPECS.flatMap((spec) =>
      spec.promptSpec.examples.flatMap((example, index) => {
        const result = spec.inputSchema.safeParse(example.args)
        return result.success ? [] : [`${spec.name}#${String(index + 1)}`]
      })
    )

    expect(invalidExamples).toEqual([])
  })
})
