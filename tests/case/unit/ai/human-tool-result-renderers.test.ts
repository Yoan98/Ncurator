import { describe, expect, it } from 'vitest'
import { renderToolResultDataText } from '../../../../src/main/services/ai/human/shared/toolResultRenderers'

describe('ai unit human tool result renderers', () => {
  it('renders generic terminal-like object fields with stdout', () => {
    const rendered = renderToolResultDataText({
      toolName: 'terminal_run',
      data: {
        command: 'pwd',
        cwd: '/tmp/workspace',
        stdout: '/tmp/workspace',
        exitCode: 0,
        timedOut: false
      }
    })

    expect(rendered).toContain('command=pwd')
    expect(rendered).toContain('cwd=/tmp/workspace')
    expect(rendered).toContain('stdout=/tmp/workspace')
    expect(rendered).toContain('exitCode=0')
    expect(rendered).toContain('timedOut=false')
  })

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

    expect(rendered).toContain('fromPercent=0')
    expect(rendered).toContain('toPercent=50')
    expect(rendered).toContain('totalRootCount=12')
    expect(rendered).toContain('fromNodeIndex=4')
    expect(rendered).toContain('toNodeIndex=4')
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

    expect(rendered).toContain('matchText=过度拟合')
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

  it('renders PDF page text, search snippets and rendered image paths', () => {
    const readRendered = renderToolResultDataText({
      toolName: 'pdf_read_pages',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pageCount: 11,
        pages: [
          {
            pageNumber: 1,
            textStatus: 'available',
            charCount: 42,
            imageCount: 1,
            text: 'inputs parameters architecture predictions labels loss update'
          }
        ]
      }
    })
    const searchRendered = renderToolResultDataText({
      toolName: 'pdf_search',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pageCount: 11,
        query: '过度拟合',
        mode: 'literal',
        totalMatchCount: 1,
        returnedMatchCount: 1,
        matches: [{ pageNumber: 9, matchedText: '过度拟合', snippet: '右图属于过度拟合' }]
      }
    })
    const visualRendered = renderToolResultDataText({
      toolName: 'pdf_read_pages',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        pages: [
          {
            pageNumber: 9,
            pageImagePath: '/runtime/page-9.png',
            text: '第9页右侧 Overfit 曲线显示验证表现变差。'
          }
        ]
      }
    })

    expect(readRendered).toContain('page 1')
    expect(readRendered).toContain('architecture')
    expect(searchRendered).toContain('pageNumber=9')
    expect(searchRendered).toContain('右图属于过度拟合')
    expect(visualRendered).toContain('page 9')
    expect(visualRendered).toContain('Overfit 曲线')
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
