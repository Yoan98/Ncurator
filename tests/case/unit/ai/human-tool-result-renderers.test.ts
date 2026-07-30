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

  it('renders nested docx_read_blocks table, cell and runs details', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_blocks',
      data: {
        sourcePath: 'graphics.docx',
        currentRevisionRef: 'v7',
        fromBlockIndex: 10,
        toBlockIndex: 12,
        blocks: [
          {
            blockId: 'b:10',
            type: 'paragraph',
            blockIndex: 10,
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
            blockId: 'b:11',
            type: 'table',
            blockIndex: 11,
            preview: '处理方法表',
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
        sourcePath: 'graphics.docx',
        totalBlockCount: 12,
        blocks: [
          {
            blockId: 'b:4',
            type: 'table',
            blockIndex: 4,
            rows: 2,
            cols: 3,
            text: '视觉方法表',
            visuals: { count: 2, kinds: ['image', 'chart'] }
          },
          {
            blockId: 'c:4:1:2',
            type: 'table_cell',
            blockIndex: 4,
            tableBlockId: 'b:4',
            row: 1,
            col: 2,
            text: '图表单元格'
          }
        ]
      }
    })

    expect(rendered).toContain('totalBlockCount=12')
    expect(rendered).toContain('rows=2')
    expect(rendered).toContain('cols=3')
    expect(rendered).toContain('visualCount=2')
    expect(rendered).toContain('visualKinds=image,chart')
    expect(rendered).toContain('tableBlockId=b:4')
    expect(rendered).toContain('row=1')
    expect(rendered).toContain('col=2')
  })

  it('renders docx_edit post-write readback instead of internal revision fields', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_edit',
      data: {
        sourcePath: 'graphics.docx',
        previousRevisionRef: 'v1',
        currentRevisionRef: 'v2',
        createdBlocks: [{ blockId: 'b:2', type: 'paragraph' }],
        warnings: [],
        postWriteReadback: {
          regions: [
            {
              fromBlockIndex: 1,
              toBlockIndex: 2,
              blocks: [
                {
                  blockId: 'b:2',
                  type: 'paragraph',
                  blockIndex: 2,
                  children: [
                    {
                      type: 'run',
                      nodeId: 'n:readback',
                      children: [{ type: 'text', text: '补充说明' }]
                    }
                  ]
                }
              ]
            }
          ]
        }
      }
    })

    expect(rendered).toContain('postWriteReadback:')
    expect(rendered).toContain('b:2')
    expect(rendered).toContain('补充说明')
    expect(rendered).not.toContain('previousRevisionRef')
    expect(rendered).not.toContain('currentRevisionRef')
    expect(rendered).not.toContain('createdBlocks')
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
      toolName: 'pdf_read_visuals',
      data: {
        sourcePath: '/workspace/深度学习.pdf',
        results: [{ index: 9, text: '第9页右侧 Overfit 曲线显示验证表现变差。' }]
      }
    })

    expect(readRendered).toContain('page 1')
    expect(readRendered).toContain('architecture')
    expect(searchRendered).toContain('pageNumber=9')
    expect(searchRendered).toContain('右图属于过度拟合')
    expect(visualRendered).toContain('index=9')
    expect(visualRendered).toContain('Overfit 曲线')
  })

  it('renders DOCX visual results with visualId', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_visuals',
      data: {
        sourcePath: '/workspace/灵感测试.docx',
        results: [
          { visualId: 'visual-18', text: '截图展示了文档中的参考界面。' },
          { visualId: 'visual-19', error: '无法唯一定位渲染元素' }
        ]
      }
    })

    expect(rendered).toContain('visualId=visual-18')
    expect(rendered).toContain('截图展示了文档中的参考界面')
    expect(rendered).toContain('visualId=visual-19')
    expect(rendered).toContain('无法唯一定位渲染元素')
  })
})
