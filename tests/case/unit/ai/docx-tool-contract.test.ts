import { describe, expect, it } from 'vitest'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../../../src/main/services/ai/human/constants'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  DOCX_READ_TOOL_SPECS,
  DOCX_TOOL_SPECS,
  DOCX_WRITE_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/docx/toolSpecs'
import { docxReadNodesSchema } from '../../../../src/main/services/ai/human/tools/docx/schemas'

const READ_TOOLS = ['docx_read_outline', 'docx_search', 'docx_read_nodes', 'docx_read_visuals']
const WRITE_TOOLS = [
  'docx_content_edit',
  'docx_format',
  'docx_table_edit',
  'docx_media_edit',
  'docx_comments_revisions'
]

describe('ai unit docx tool contract', () => {
  it('exposes exactly four read tools and five write tools', () => {
    expect(DOCX_READ_TOOL_SPECS.map((spec) => spec.name)).toEqual(READ_TOOLS)
    expect(DOCX_WRITE_TOOL_SPECS.map((spec) => spec.name)).toEqual(WRITE_TOOLS)
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(SKILL_DEFINITIONS['docx-read'].toolNames).toEqual(READ_TOOLS)
    expect(SKILL_DEFINITIONS['docx-write'].toolNames).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(DOCX_TOOL_SPECS).toHaveLength(9)
    expect(DOCX_TOOL_SPECS.length).toBeLessThan(HUMAN_MAX_ACTIVE_TOOLS)
  })

  it('keeps every public call to one discriminated operation', () => {
    for (const spec of DOCX_WRITE_TOOL_SPECS) {
      expect(spec.promptSpec.description).not.toContain('actions[]')
      expect(spec.promptSpec.description).not.toContain('nodeId')
      expect(spec.promptSpec.description).not.toContain('\n')
    }
  })

  it('bounds detailed node reads', () => {
    expect(
      docxReadNodesSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        range: { type: 'node_index', fromNodeIndex: 10, toNodeIndex: 59 }
      }).success
    ).toBe(true)
    expect(
      docxReadNodesSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        range: { type: 'node_index', fromNodeIndex: 10, toNodeIndex: 60 }
      }).success
    ).toBe(false)
    expect(
      docxReadNodesSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        range: {
          type: 'node_ids',
          nodeIds: Array.from({ length: 21 }, (_, index) => `node-${String(index)}`)
        }
      }).success
    ).toBe(false)
  })
})
