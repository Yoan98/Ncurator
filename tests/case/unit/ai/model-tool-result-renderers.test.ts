import { describe, expect, it } from 'vitest'
import {
  renderTerminalReadModelResult,
  renderTerminalRunModelResult,
  renderTextFileEditModelResult,
  renderTextFileReadModelResult,
  renderWebSearchModelResult
} from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

describe('ai unit model tool result renderers', () => {
  it('renders terminal_run as stream with status and terminalId markers', () => {
    const rendered = renderTerminalRunModelResult({
      toolName: 'terminal_run',
      args: {},
      data: {
        terminalId: 'term-001',
        status: 'succeeded',
        output: 'done\n',
        readEndPosition: 5,
        hasMoreOutput: false
      }
    })

    expect(rendered).toContain('done')
    expect(rendered).toContain('[status: succeeded]')
    expect(rendered).toContain('[terminalId: term-001]')
    expect(rendered).not.toContain('exitCode')
  })

  it('renders terminal_read without terminalId marker', () => {
    const rendered = renderTerminalReadModelResult({
      toolName: 'terminal_read',
      args: { terminalId: 'term-001' },
      data: {
        status: 'running',
        output: 'more\n',
        readEndPosition: 12,
        hasMoreOutput: true
      }
    })

    expect(rendered).toContain('[status: running]')
    expect(rendered).not.toContain('[terminalId:')
  })

  it('renders text_file_read as xml envelope with numbered lines', () => {
    const rendered = renderTextFileReadModelResult({
      toolName: 'text_file_read',
      args: { sourcePath: '/workspace/readme.md' },
      data: {
        content: 'alpha\nbeta',
        startLine: 1,
        endLine: 2,
        totalLines: 10
      }
    })

    expect(rendered).toContain('<file path="/workspace/readme.md">')
    expect(rendered).toContain('<type>text</type>')
    expect(rendered).toContain('1: alpha')
    expect(rendered).toContain('2: beta')
    expect(rendered).toContain('(Showing lines 1-2 of 10.)')
  })

  it('renders text_file_edit as prose confirmation', () => {
    const rendered = renderTextFileEditModelResult({
      toolName: 'text_file_edit',
      args: { sourcePath: '/workspace/app.ts', action: 'edit' },
      data: {}
    })

    expect(rendered).toBe('The file /workspace/app.ts has been updated successfully.')
  })

  it('renders web_search query results with markdown bodies', () => {
    const rendered = renderWebSearchModelResult({
      toolName: 'web_search',
      args: { query: 'vitest snapshot' },
      data: {
        items: [
          {
            requestedUrl: 'https://vitest.dev/guide/snapshot',
            title: 'Snapshot Testing | Vitest',
            markdown: '# Snapshot Testing\n\nUse toMatchSnapshot().'
          }
        ]
      }
    })

    expect(rendered).toContain('Web search completed. Query: vitest snapshot')
    expect(rendered).toContain('# Snapshot Testing')
    expect(rendered).toContain('toMatchSnapshot()')
    expect(rendered).toContain('https://vitest.dev/guide/snapshot')
  })
})
