import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  DOCX_EDIT_TOOL_SPEC,
  DOCX_READ_TOOL_SPECS,
  DOCX_TOOL_SPECS,
  DOCX_WRITE_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/docx/toolSpecs'

const OLD_DOCX_WRITE_TOOL_NAMES = [
  'docx_create',
  'docx_paragraph_edit',
  'docx_heading_edit',
  'docx_table_edit',
  'docx_text_edit',
  'docx_text_style_edit',
  'docx_delete'
]

describe('ai unit docx tool contract', () => {
  it('only exposes content reading tools and docx_edit', () => {
    expect(DOCX_READ_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'docx_read_outline',
      'docx_search',
      'docx_read_blocks'
    ])
    expect(DOCX_WRITE_TOOL_SPECS.map((spec) => spec.name)).toEqual(['docx_edit'])
    expect(SKILL_DEFINITIONS['docx-read'].toolNames).toEqual([
      'docx_read_outline',
      'docx_search',
      'docx_read_blocks'
    ])
    expect(SKILL_DEFINITIONS['docx-write'].toolNames).toEqual(['docx_edit'])
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).not.toEqual(
      expect.arrayContaining(OLD_DOCX_WRITE_TOOL_NAMES)
    )
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).not.toEqual(
      expect.arrayContaining(['docx_history', 'docx_rollback'])
    )
  })

  it('keeps the edit prompt as one capability sentence without implementation details', () => {
    const description = DOCX_EDIT_TOOL_SPEC.promptSpec.description
    expect(description).not.toContain('\n')
    for (const internalTerm of [
      'revision',
      'replay',
      'checksum',
      'UUID',
      'blk_',
      'blockIndex',
      'postWriteReadback',
      '原子',
      'action type='
    ]) {
      expect(description).not.toContain(internalTerm)
    }
  })
})
