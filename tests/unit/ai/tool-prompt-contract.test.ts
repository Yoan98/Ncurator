import { describe, expect, it } from 'vitest'
import { ALL_TOOL_SPECS } from '../../../src/main/services/ai/human/tools/registry'

describe('ai unit tool prompt contract', () => {
  it('requires every tool spec to provide schema-valid examples', () => {
    const missingExamples = ALL_TOOL_SPECS.filter((spec) => spec.promptSpec.examples.length === 0).map(
      (spec) => spec.name
    )
    const invalidExamples = ALL_TOOL_SPECS.flatMap((spec) =>
      spec.promptSpec.examples.flatMap((example, index) => {
        const result = spec.inputSchema.safeParse(example.args)
        return result.success ? [] : [`${spec.name}#${String(index + 1)}`]
      })
    )

    expect(missingExamples).toEqual([])
    expect(invalidExamples).toEqual([])
  })
})
