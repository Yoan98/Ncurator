import { describe, expect, it } from 'vitest'
import { humanDecisionSchema } from '../../../src/main/services/ai/human/schema'
import { ALL_TOOL_SPECS } from '../../../src/main/services/ai/human/tools/registry'
import { DOCX_TABLE_EDIT_TOOL_SPEC } from '../../../src/main/services/ai/human/tools/docx/toolSpecs'
import {
  renderBrainOutputSchemaForPrompt,
  renderSchemaShape,
  renderToolSchemaForPrompt
} from '../../../src/main/services/ai/human/tools/schemaPromptRenderer'

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

  it('renders docx_table_edit schema with rows structure', () => {
    const promptText = renderToolSchemaForPrompt(DOCX_TABLE_EDIT_TOOL_SPEC.schema)

    expect(promptText).toContain('输入结构：')
    expect(promptText).toContain('insert_after')
    expect(promptText).toContain('anchorBlockId')
    expect(promptText).toContain('rows')
    expect(promptText).toContain('update_cell')
    expect(promptText).toContain('cellBlockId')
  })

  it('renders brain decision schema as output shape', () => {
    const shapeText = renderSchemaShape(humanDecisionSchema)
    const promptText = renderBrainOutputSchemaForPrompt(humanDecisionSchema)

    expect(shapeText).toContain('updatedStableMemory?')
    expect(shapeText).toContain('decision:')
    expect(shapeText).toContain('checklist?: Array<')
    expect(shapeText).toContain('nextAction:')
    expect(promptText).toContain('输出 JSON 结构：')
    expect(promptText).toContain('toolUsePlan')
    expect(promptText).toContain('calls')
  })
})
