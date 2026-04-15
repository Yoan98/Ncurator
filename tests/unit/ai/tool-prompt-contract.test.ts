import { describe, expect, it } from 'vitest'
import { ALL_TOOL_SPECS } from '../../../src/main/services/ai/human/tools/registry'
import { DOCX_APPLY_OPS_TOOL_SPEC } from '../../../src/main/services/ai/human/tools/docx/toolSpecs'
import { renderToolSchemaForPrompt } from '../../../src/main/services/ai/human/tools/schemaPromptRenderer'

describe('ai unit tool prompt contract', () => {
  it('requires every tool spec to provide schema-valid examples', () => {
    const missingExamples = ALL_TOOL_SPECS.filter((spec) => spec.promptSpec.examples.length === 0).map(
      (spec) => spec.name
    )
    const invalidExamples = ALL_TOOL_SPECS.flatMap((spec) =>
      spec.promptSpec.examples.flatMap((example, index) => {
        const result = spec.schema.safeParse(example.args)
        return result.success ? [] : [`${spec.name}#${String(index + 1)}`]
      })
    )

    expect(missingExamples).toEqual([])
    expect(invalidExamples).toEqual([])
  })

  it('requires multiple examples for high-risk structured tools', () => {
    const highRiskToolNames = ['docx_apply_ops', 'docx_rollback', 'terminal_run_command']
    const insufficientExamples = ALL_TOOL_SPECS.filter(
      (spec) => highRiskToolNames.includes(spec.name) && spec.promptSpec.examples.length < 2
    ).map((spec) => spec.name)

    expect(insufficientExamples).toEqual([])
  })

  it('renders docx_apply_ops schema with nested paragraph and table structure', () => {
    const promptText = renderToolSchemaForPrompt(DOCX_APPLY_OPS_TOOL_SPEC.schema)

    expect(promptText).toContain('输入结构：')
    expect(promptText).toContain('insert_after')
    expect(promptText).toContain('anchorBlockId')
    expect(promptText).toContain('kind')
    expect(promptText).toContain('paragraph')
    expect(promptText).toContain('runs')
    expect(promptText).toContain('table')
    expect(promptText).toContain('rows')
  })
})
