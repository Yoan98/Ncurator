import { describe, expect, it } from 'vitest'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../../../src/main/services/ai/human/constants'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  DOCX_MUTATION_TOOL_SPECS,
  DOCX_READ_TOOL_SPECS,
  DOCX_TOOL_SPECS,
  DOCX_WRITE_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/docx/toolSpecs'
import {
  docxFormatSchema,
  docxOutlineSchema,
  docxReadNodesSchema
} from '../../../../src/main/services/ai/human/tools/docx/toolSchemas'
import type { DocxMutationOutput } from '../../../../src/main/services/ai/human/tools/docx/outputTypes'

const READ_TOOLS = ['docx_read_outline', 'docx_search', 'docx_read_nodes']
const WRITE_TOOLS = [
  'docx_content_edit',
  'docx_format',
  'docx_table_edit',
  'docx_comments_revisions'
]

describe('ai unit docx tool contract', () => {
  it('exposes independent 3/4 docx skill toolsets', () => {
    expect(DOCX_READ_TOOL_SPECS.map((spec) => spec.name)).toEqual(READ_TOOLS)
    expect(DOCX_WRITE_TOOL_SPECS.map((spec) => spec.name)).toEqual(WRITE_TOOLS)
    expect(DOCX_MUTATION_TOOL_SPECS.map((spec) => spec.name)).toEqual(WRITE_TOOLS)
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(SKILL_DEFINITIONS['docx-read'].toolNames).toEqual(READ_TOOLS)
    expect(SKILL_DEFINITIONS['docx-write'].toolNames).toEqual(WRITE_TOOLS)
    expect(DOCX_TOOL_SPECS).toHaveLength(7)
    expect(DOCX_TOOL_SPECS.length).toBeLessThan(HUMAN_MAX_ACTIVE_TOOLS)
  })

  it('combines docx skills without hidden tools', () => {
    const toolNames = ['docx-read', 'docx-write'].flatMap(
      (skillId) => SKILL_DEFINITIONS[skillId as 'docx-read' | 'docx-write'].toolNames
    )

    expect(toolNames).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
  })

  it('keeps every public call to one discriminated operation', () => {
    for (const spec of DOCX_MUTATION_TOOL_SPECS) {
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

  it('uses percent outline ranges', () => {
    expect(
      docxOutlineSchema.safeParse({ sourcePath: '/tmp/a.docx', fromPercent: 0, toPercent: 50 })
        .success
    ).toBe(true)
    expect(docxOutlineSchema.safeParse({ sourcePath: '/tmp/a.docx' }).success).toBe(false)
    expect(
      docxOutlineSchema.safeParse({ sourcePath: '/tmp/a.docx', fromPercent: 0, toPercent: 100 })
        .success
    ).toBe(true)
    expect(
      docxOutlineSchema.safeParse({ sourcePath: '/tmp/a.docx', fromPercent: 80, toPercent: 20 })
        .success
    ).toBe(false)
  })

  it('bounds format batches and rejects duplicate or removed single-target input', () => {
    expect(
      docxFormatSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        type: 'format_paragraph',
        nodeIds: ['p1', 'p2'],
        format: { alignment: 'center' }
      }).success
    ).toBe(true)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        type: 'format_paragraph',
        nodeIds: ['p1', 'p1'],
        format: { alignment: 'center' }
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        type: 'format_paragraph',
        nodeIds: Array.from({ length: 21 }, (_, index) => `p${String(index)}`),
        format: { alignment: 'center' }
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        type: 'format_text',
        targets: [{ nodeId: 'p1' }, { nodeId: 'p1', text: 'title' }],
        format: { bold: true }
      }).success
    ).toBe(false)
    expect(
      docxFormatSchema.safeParse({
        sourcePath: '/tmp/a.docx',
        type: 'format_paragraph',
        nodeId: 'p1',
        format: { alignment: 'center' }
      }).success
    ).toBe(false)
  })

  it('keeps docx mutation output minimal', () => {
    const empty = {} satisfies DocxMutationOutput
    const withIds = { createdIds: ['node_1'] } satisfies DocxMutationOutput
    expect(empty).toEqual({})
    expect(withIds.createdIds).toEqual(['node_1'])
    expect('createdIds' in empty).toBe(false)
  })
})
