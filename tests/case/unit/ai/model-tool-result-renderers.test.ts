import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AiRunContext } from '../../../../src/main/services/ai/types'
import {
  buildModelToolResultDelivery,
  exceedsToolResultRejectLimit
} from '../../../../src/main/services/ai/human/shared/modelToolResult'
import {
  renderDocxContentEditModelResult,
  renderDocxReadNodesModelResult,
  renderExcelReadModelResult,
  renderGenericModelResult,
  renderKbSearchModelResult
} from '../../../../src/main/services/ai/human/shared/modelToolResultRenderers'

const tempRoots: string[] = []

const createContext = async (): Promise<AiRunContext> => {
  const rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'ncurator-model-result-'))
  tempRoots.push(rootPath)
  return {
    runId: 'run-1',
    platform: 'macos',
    workspace: { rootPath }
  } as unknown as AiRunContext
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  )
})

describe('ai unit model-facing tool result renderers', () => {
  it('accepts exact reject limits and rejects the first byte or line beyond them', () => {
    expect(
      exceedsToolResultRejectLimit({
        totalBytes: 51_200,
        totalLines: 2_000
      })
    ).toBe(false)
    expect(
      exceedsToolResultRejectLimit({
        totalBytes: 51_201,
        totalLines: 2_000
      })
    ).toBe(true)
    expect(
      exceedsToolResultRejectLimit({
        totalBytes: 1,
        totalLines: 2_001
      })
    ).toBe(true)
  })
  it('keeps complete KB chunks, deduplicates sources and retains document IDs', () => {
    const content = '原始知识块，不允许生成 excerpt。'
    const rendered = renderKbSearchModelResult({
      toolName: 'kb_search',
      args: {},
      data: {
        items: [
          {
            id: 'chunk-internal-1',
            documentId: 'doc-1',
            documentName: '方法论.md',
            sourceType: 'file',
            filePath: '/workspace/方法论.md',
            text: content
          },
          {
            id: 'chunk-internal-2',
            documentId: 'doc-1',
            documentName: '方法论.md',
            sourceType: 'file',
            filePath: '/workspace/方法论.md',
            text: '第二个完整知识块。'
          }
        ],
        total: 2
      }
    })

    expect(rendered).toContain(content)
    expect(rendered).toContain('第二个完整知识块。')
    expect(rendered).toContain('documentId=doc-1')
    expect(rendered.match(/\[d1\] name=/gu)).toHaveLength(1)
    expect(rendered).not.toContain('chunk-internal')
    expect(rendered).not.toContain('_score')
  })

  it('deduplicates DOCX styles without dropping explicit zero and false values', () => {
    const rendered = renderDocxReadNodesModelResult({
      toolName: 'docx_read_nodes',
      args: {},
      data: {
        nodes: [
          {
            type: 'paragraph',
            nodeId: 'p1',
            style: { keepNext: false, spacingBefore: 0, styleId: '' },
            children: [
              {
                type: 'run',
                nodeId: 'r1',
                story: { storyId: 'body', type: 'body' },
                style: { bold: false, fontSize: 0 },
                children: [
                  { type: 'text', text: '相邻' },
                  { type: 'text', text: '文字' },
                  { type: 'break', kind: 'page' },
                  {
                    type: 'visual',
                    nodeId: 'v1',
                    kind: 'image',
                    imagePath: '/workspace/image.png',
                    altText: ''
                  }
                ]
              }
            ]
          },
          {
            type: 'paragraph',
            nodeId: 'p2',
            style: { styleId: '', spacingBefore: 0, keepNext: false },
            children: []
          }
        ]
      }
    })

    expect(rendered.match(/S1:/gu)).toHaveLength(1)
    expect(rendered.match(/style=S1/gu)).toHaveLength(2)
    expect(rendered).toContain('spacingBefore: 0')
    expect(rendered).toContain('keepNext: false')
    expect(rendered).toContain('styleId: ""')
    expect(rendered).toContain('bold: false')
    expect(rendered).toContain('fontSize: 0')
    expect(rendered).toContain('text="相邻文字"')
    expect(rendered).toContain('kind="page"')
    expect(rendered).toContain('nodeId="v1"')
    expect(rendered).toContain('imagePath="/workspace/image.png"')
  })

  it('renders concise DOCX mutation success text', () => {
    expect(
      renderDocxContentEditModelResult({
        toolName: 'docx_content_edit',
        args: { sourcePath: '/workspace/目标.docx' },
        data: { createdIds: ['node-1', 'node-2'] }
      })
    ).toBe('DOCX content edit completed successfully: 目标.docx\nCreated node IDs: node-1, node-2')
  })

  it('renders Excel range, style and search projections for the model', () => {
    const range = renderExcelReadModelResult({
      toolName: 'excel_read',
      args: { type: 'range' },
      data: {
        sheetName: 'Data',
        range: 'A1:B2',
        rows: [
          ['Item', 12],
          ['A', { formula: 'B2*2', value: 24 }]
        ]
      }
    })
    expect(range).toContain('Range: A1:B2 (columns A–B, rows 1–2)')
    expect(range).toContain('| 1 | Item | 12 |')
    expect(range).toContain('| 2 | A | =B2*2 => 24 |')

    const style = renderExcelReadModelResult({
      toolName: 'excel_read',
      args: { type: 'style' },
      data: {
        sheetName: 'Data',
        range: 'A1',
        rows: [[{ bold: true, fontColor: 'FF0000', fillColor: null, numberFormat: '#,##0' }]]
      }
    })
    expect(style).toContain('Range: A1 (column A, row 1)')
    expect(style).toContain('| Cell | bold | fontColor | fillColor | numberFormat |')
    expect(style).toContain('| A1 | true | FF0000 |  | #,##0 |')

    const search = renderExcelReadModelResult({
      toolName: 'excel_read',
      args: { type: 'search' },
      data: {
        truncated: false,
        matches: [
          { sheetName: 'Data', address: 'C2', formula: 'B2*2' },
          { sheetName: 'Data', address: 'A1', value: 'Item' }
        ]
      }
    })
    expect(search).toContain('sheet=Data cell=C2 formula=B2*2')
    expect(search).toContain('sheet=Data cell=A1 value=Item')
    expect(search).not.toContain('!')
  })

  it('uses a lossless multiline generic fallback instead of a JSON envelope', () => {
    const rendered = renderGenericModelResult({
      toolName: 'web_search',
      args: {},
      data: { markdown: 'first line\nsecond line', links: [{ href: 'https://example.com' }] }
    })
    expect(rendered).toContain('web_search completed successfully.')
    expect(rendered).toContain('markdown:')
    expect(rendered).toContain('first line')
    expect(rendered).toContain('second line')
    expect(rendered).not.toMatch(/^\{"status"/u)
  })

  it('rejects oversized rendered tool results for any tool without exposing a spill path', async () => {
    const ctx = await createContext()
    const delivery = await buildModelToolResultDelivery({
      ctx,
      toolCallId: 'kb-large',
      args: { queryText: 'test', limit: 50 },
      result: {
        toolName: 'kb_search',
        ok: true,
        data: {
          items: [
            {
              documentId: 'doc-1',
              documentName: 'large.txt',
              sourceType: 'file',
              filePath: '/workspace/large.txt',
              text: 'x'.repeat(60_000)
            }
          ],
          total: 1
        }
      }
    })
    expect(delivery.ok).toBe(false)
    expect(delivery.content).toContain('Error: The result from kb_search is too large')
    expect(delivery.content).toContain('Narrow the tool arguments')
    expect(delivery.content).not.toContain('Full result:')
  })

  it('spills oversized rendered tool results with head and tail previews', async () => {
    const ctx = await createContext()
    const tail = 'TAIL_SENTINEL'
    const delivery = await buildModelToolResultDelivery({
      ctx,
      toolCallId: 'web-large',
      args: { url: 'https://example.com' },
      result: {
        toolName: 'web_search',
        ok: true,
        data: {
          items: [{ markdown: `${'x'.repeat(40_000)}${tail}`, requestedUrl: 'https://example.com' }]
        }
      }
    })
    expect(delivery.ok).toBe(true)
    expect(delivery.content).toContain('Result too large to include inline.')
    expect(delivery.content).toContain('Preview (tail):')
    expect(delivery.content).toContain(tail)
    const filePath = delivery.content.match(/Full result: (.+\.txt)/u)?.[1]
    expect(filePath).toBeTruthy()
    const persisted = await fs.readFile(filePath || '', 'utf8')
    expect(persisted).toContain(tail)
    expect(persisted.split('\n').every((line) => Array.from(line).length <= 1_600)).toBe(true)
  })

  it('spills producer-bounded text_file_read windows when rendered output exceeds spill threshold', async () => {
    const ctx = await createContext()
    const tail = 'TAIL_SENTINEL'
    const delivery = await buildModelToolResultDelivery({
      ctx,
      toolCallId: 'text-window',
      args: { sourcePath: '/workspace/large.txt' },
      result: {
        toolName: 'text_file_read',
        ok: true,
        data: {
          content: `${'x'.repeat(40_000)}${tail}`,
          startLine: 1,
          endLine: 1,
          totalLines: 2,
          nextStartLine: 2
        }
      }
    })
    expect(delivery.ok).toBe(true)
    expect(delivery.content).toContain('Result too large to include inline.')
    expect(delivery.content).toContain('Preview (tail):')
    expect(delivery.content).toContain(tail)
  })
})
