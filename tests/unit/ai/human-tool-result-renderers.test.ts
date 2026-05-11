import { describe, expect, it } from 'vitest'
import { renderToolResultDataText } from '../../../src/main/services/ai/human/shared/toolResultRenderers'

describe('ai unit human tool result renderers', () => {
  it('renders generic terminal-like object fields without collapsing to outputPreview only', () => {
    const rendered = renderToolResultDataText({
      toolName: 'terminal_run',
      data: {
        command: 'pwd',
        cwd: '/tmp/workspace',
        outputPreview: '/tmp/workspace',
        exitCode: 0,
        timedOut: false,
        truncated: false
      }
    })

    expect(rendered).toContain('command=pwd')
    expect(rendered).toContain('cwd=/tmp/workspace')
    expect(rendered).toContain('outputPreview=/tmp/workspace')
    expect(rendered).toContain('exitCode=0')
    expect(rendered).toContain('timedOut=false')
    expect(rendered).toContain('truncated=false')
  })

  it('renders nested docx_read_blocks table, cell and runs details', () => {
    const rendered = renderToolResultDataText({
      toolName: 'docx_read_blocks',
      data: {
        sourcePath: 'graphics.docx',
        currentRevisionRef: 'v7',
        fromBlockId: 'b:10',
        toBlockId: 'b:12',
        returnedBlockCount: 2,
        blocks: [
          {
            blockId: 'b:10',
            type: 'paragraph',
            bodyIndex: 10,
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
            bodyIndex: 11,
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
                    bodyIndex: 11,
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
                    bodyIndex: 11,
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
})
