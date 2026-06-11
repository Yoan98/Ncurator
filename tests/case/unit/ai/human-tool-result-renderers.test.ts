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
            text: '反走样定义',
            runs: [
              {
                text: '反走样',
                bold: true
              },
              {
                text: '用于减轻锯齿。'
              }
            ]
          },
          {
            blockId: 'b:11',
            type: 'table',
            blockIndex: 11,
            preview: '处理方法表',
            cells: [
              {
                blockId: 'b:11:c1',
                row: 0,
                col: 0,
                paragraphs: [
                  {
                    blockId: 'b:11:c1:p1',
                    type: 'paragraph',
                    blockIndex: 11,
                    text: '多个像素点',
                    runs: [{ text: '多个像素点' }]
                  }
                ]
              },
              {
                blockId: 'b:11:c2',
                row: 0,
                col: 1,
                paragraphs: [
                  {
                    blockId: 'b:11:c2:p1',
                    type: 'paragraph',
                    blockIndex: 11,
                    text: '低通滤波',
                    runs: [{ text: '低通滤波' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    expect(rendered).toContain('runs:')
    expect(rendered).toContain('text=反走样')
    expect(rendered).toContain('bold=true')
    expect(rendered).toContain('cells:')
    expect(rendered).toContain('blockId=b:11:c1')
    expect(rendered).toContain('多个像素点')
    expect(rendered).toContain('低通滤波')
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
                  text: '补充说明'
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
})
