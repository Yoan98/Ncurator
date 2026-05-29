import { describe, expect, it } from 'vitest'
import { SKILL_DEFINITIONS } from '../../../src/main/services/ai/human/skills'
import {
  DOCX_TOOL_SPECS,
  DOCX_WRITE_TOOL_SPECS
} from '../../../src/main/services/ai/human/tools/docx/toolSpecs'

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
  it('only exposes docx_edit and docx_rollback as docx write tools', () => {
    expect(DOCX_WRITE_TOOL_SPECS.map((spec) => spec.name)).toEqual([
      'docx_edit',
      'docx_rollback'
    ])
    expect(SKILL_DEFINITIONS['docx-write'].toolNames).toEqual([
      'docx_edit',
      'docx_rollback'
    ])
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).not.toEqual(
      expect.arrayContaining(OLD_DOCX_WRITE_TOOL_NAMES)
    )
  })
})
