import { renderToolResultDataText } from '../../../../src/main/services/ai/human/shared/toolResultRenderers'
import { describe, expect, it } from 'vitest'
import { HUMAN_MAX_ACTIVE_TOOLS } from '../../../../src/main/services/ai/human/constants'
import { SKILL_DEFINITIONS } from '../../../../src/main/services/ai/human/skills'
import {
  DOCX_WRITE_TOOL_SPECS,
  DOCX_READ_TOOL_SPECS,
  DOCX_TOOL_SPECS
} from '../../../../src/main/services/ai/human/tools/docx/toolSpecs'
import {
  docxFormatSchema,
  docxOutlineSchema,
  docxReadNodesSchema
} from '../../../../src/main/services/ai/human/tools/docx/toolSchemas'

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
    expect(DOCX_TOOL_SPECS.map((spec) => spec.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS])
    expect(SKILL_DEFINITIONS['docx-read'].toolNames).toEqual(READ_TOOLS)
    expect(SKILL_DEFINITIONS['docx-write'].toolNames).toEqual(WRITE_TOOLS)
    expect(DOCX_TOOL_SPECS).toHaveLength(7)
    expect(DOCX_TOOL_SPECS.length).toBeLessThan(HUMAN_MAX_ACTIVE_TOOLS)
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
})

describe('tool result data fidelity', () => {
  it('renders nested docx_read_nodes table, cell and runs details', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_nodes',
      data: {
        sourcePath: 'graphics.docx',
        nodes: [
          {
            nodeId: 'node_10',
            type: 'paragraph',
            story: { storyId: 'body', type: 'body' },
            children: [
              {
                type: 'run',
                nodeId: 'n:1',
                style: { bold: true },
                children: [{ type: 'text', text: '反走样定义' }]
              }
            ]
          },
          {
            nodeId: 'node_11',
            type: 'table',
            story: { storyId: 'body', type: 'body' },
            children: [
              {
                type: 'table_row',
                nodeId: 'row:1',
                children: [
                  {
                    nodeId: 'b:11:c1',
                    type: 'table_cell',
                    row: 0,
                    col: 0,
                    children: [
                      {
                        nodeId: 'b:11:c1:p1',
                        type: 'paragraph',
                        children: [
                          {
                            type: 'run',
                            nodeId: 'n:2',
                            children: [{ type: 'text', text: '多个像素点' }]
                          }
                        ]
                      }
                    ]
                  },
                  {
                    nodeId: 'b:11:c2',
                    type: 'table_cell',
                    row: 0,
                    col: 1,
                    children: [
                      {
                        nodeId: 'b:11:c2:p1',
                        type: 'paragraph',
                        children: [
                          {
                            type: 'run',
                            nodeId: 'n:3',
                            children: [{ type: 'text', text: '低通滤波' }]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    expect(rendered).toContain('n:1')
    expect(rendered).toContain('反走样定义')
    expect(rendered).toContain('table_row')
    expect(rendered).toContain('b:11:c1')
    expect(rendered).toContain('多个像素点')
    expect(rendered).toContain('低通滤波')
  })

  it('renders lightweight DOCX outline positioning and visual summaries', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_outline',
      data: {
        fromPercent: 0,
        toPercent: 50,
        fromNodeIndex: 4,
        toNodeIndex: 4,
        totalRootCount: 12,
        segments: [
          {
            story: 'body',
            fromNodeIndex: 4,
            toNodeIndex: 4,
            textMap: '结构：表格 2x3 视觉方法表\n关键词：视觉方法\n代表句：[4] 视觉方法表'
          }
        ]
      }
    })

    expect(rendered).toContain('视觉方法表')
    expect(rendered).not.toContain('nodeId')
  })

  it('renders DOCX match-centered and neighboring context', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_search',
      data: {
        totalMatchCount: 1,
        matches: [
          {
            nodeId: 'node_3',
            nodeIndex: 3,
            type: 'paragraph',
            story: 'body',
            matchText: '过度拟合',
            textContext: '训练过久时可能出现过度拟合。',
            before: [
              { nodeId: 'node_2', nodeIndex: 2, type: 'paragraph', textPreview: '训练背景' }
            ],
            after: [{ nodeId: 'node_4', nodeIndex: 4, type: 'table', textPreview: '缓解方法' }]
          }
        ]
      }
    })

    expect(rendered).toContain('过度拟合')
    expect(rendered).toContain('训练过久时可能出现过度拟合')
    expect(rendered).toContain('node_2')
    expect(rendered).toContain('训练背景')
    expect(rendered).toContain('node_4')
    expect(rendered).toContain('缓解方法')
  })

  it('renders only created ids for DOCX mutations', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_content_edit',
      data: {
        createdIds: ['node_2']
      }
    })

    expect(rendered).toContain('createdIds')
    expect(rendered).toContain('node_2')
    expect(rendered).not.toContain('changes')
    expect(renderToolResultDataText({ toolName: 'docx_format', data: {} })).toBeUndefined()
  })

  it('renders DOCX read nodes with nodeId', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_nodes',
      data: {
        sourcePath: '/workspace/灵感测试.docx',
        nodes: [
          {
            type: 'paragraph',
            nodeId: 'node-18',
            text: '截图展示了文档中的参考界面。',
            children: []
          }
        ]
      }
    })

    expect(rendered).toContain('node-18')
    expect(rendered).toContain('截图展示了文档中的参考界面')
  })
})
