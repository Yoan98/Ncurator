import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type OutlineNode = {
  nodeId: string
  nodeIndex: number
  type: 'paragraph' | 'table' | 'content_control' | 'revision'
  story: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox'
  textPreview: string
}

type OutlineResult = {
  startPage: number
  endPage: number
  totalPages: number
  nodes: OutlineNode[]
}

describe('ai tool docx outline pagination backend', () => {
  it('docx-outline-pagination', async () => {
    await runBackendCase({
      caseId: 'docx-outline-pagination',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 DOCX outline 逻辑分页、预览截取、story 和越界错误。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const longText = `${'前'.repeat(110)} ${'后'.repeat(70)}`
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'outline-pages.docx', [
          ...Array.from({ length: 106 }, (_, index) => ({
            type: 'paragraph' as const,
            text: index === 50 ? longText : `Paragraph ${String(index + 1)}`
          })),
          {
            type: 'table' as const,
            rows: [
              ['A1', 'A2'],
              ['B1', 'B2'],
              ['C1', 'LastCell']
            ]
          }
        ])
        const zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
        const relationshipsPath = 'word/_rels/document.xml.rels'
        const relationships = await zip.file(relationshipsPath)!.async('text')
        zip.file(
          relationshipsPath,
          relationships.replace(
            '</Relationships>',
            '<Relationship Id="rIdOutlineHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header-outline.xml"/></Relationships>'
          )
        )
        zip.file(
          'word/header-outline.xml',
          '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header outline</w:t></w:r></w:p></w:hdr>'
        )
        await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
        const emptyPath = await writeTestDocxFile(runtime.workspaceRoot, 'outline-empty.docx', [])
        const harness = createDocxToolHarness(runtime)
        try {
          const first = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            startPage: 1,
            pageCount: 1
          })
          const rest = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            startPage: 2,
            pageCount: 2
          })
          const outOfRange = await harness.invoke('docx_read_outline', {
            sourcePath,
            startPage: 4,
            pageCount: 1
          })
          const empty = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath: emptyPath,
            startPage: 1,
            pageCount: 1
          })
          return { first, rest, outOfRange, empty }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const longPreview =
          result.rest.nodes.find((node) => node.nodeIndex === 50)?.textPreview || ''
        const tablePreview = result.rest.nodes.find((node) => node.type === 'table')?.textPreview
        runtime.assertThat(
          result.first.startPage === 1 &&
            result.first.endPage === 1 &&
            result.first.totalPages === 3 &&
            result.first.nodes.length === 50 &&
            result.rest.startPage === 2 &&
            result.rest.endPage === 3 &&
            result.rest.totalPages === 3 &&
            result.rest.nodes.every((node) => node.type !== 'table_cell') &&
            Array.from(longPreview).length === 160 &&
            longPreview.startsWith('前'.repeat(100)) &&
            longPreview.includes('…') &&
            longPreview.endsWith('后'.repeat(59)) &&
            tablePreview === 'A1 | A2 | B1 | B2 | C1 | LastCell' &&
            result.rest.nodes.some(
              (node) => node.story === 'header' && node.textPreview === 'Header outline'
            ) &&
            JSON.stringify(result.outOfRange).includes('invalid_input') &&
            JSON.stringify(result.outOfRange).includes('totalPages=3') &&
            result.empty.totalPages === 1 &&
            result.empty.startPage === 1 &&
            result.empty.endPage === 1 &&
            result.empty.nodes.length === 0,
          {
            name: 'docx-outline-logical-pages',
            message: 'DOCX outline 应按 50 个节点逻辑分页并稳定执行首尾预览截取。',
            data: result
          }
        )
      }
    })
  })
})
