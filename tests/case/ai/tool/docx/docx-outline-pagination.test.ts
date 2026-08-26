import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { describe, it } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

type OutlineSegment = {
  story: 'body' | 'header' | 'footer' | 'footnote' | 'endnote' | 'textbox'
  fromNodeIndex: number
  toNodeIndex: number
  textMap: string
}

type OutlineResult = {
  startPage: number
  endPage: number
  totalPages: number
  segments: OutlineSegment[]
}

describe('ai tool docx outline pagination backend', () => {
  it('docx-outline-pagination', async () => {
    await runBackendCase({
      caseId: 'docx-outline-pagination',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 DOCX segment map 分页、覆盖、摘要预算、story 和越界错误。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'outline-pages.docx', [
          ...Array.from({ length: 486 }, (_, index) => ({
            type: 'paragraph' as const,
            text:
              index === 250
                ? `关键中段 ${'前'.repeat(180)} 训练稳定性 ${'后'.repeat(180)}`
                : `Paragraph ${String(index + 1)} discusses topic ${String(index % 17)}`
          })),
          {
            type: 'table' as const,
            rows: [
              ['Capability', 'State'],
              ['Segment map', 'Ready']
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
        const allSegments = [...result.first.segments, ...result.rest.segments]
        const bodySegments = allSegments.filter((segment) => segment.story === 'body')
        const coveredBodyNodes = bodySegments.reduce(
          (total, segment) => total + segment.toNodeIndex - segment.fromNodeIndex + 1,
          0
        )
        runtime.assertThat(
          result.first.totalPages === 3 &&
            result.first.segments.length === 12 &&
            result.rest.startPage === 2 &&
            result.rest.endPage === 3 &&
            result.rest.segments.length === 14 &&
            coveredBodyNodes === 487 &&
            allSegments.every((segment) => Array.from(segment.textMap).length <= 360) &&
            allSegments.some(
              (segment) =>
                segment.textMap.includes('表格 2x2') &&
                segment.fromNodeIndex === segment.toNodeIndex
            ) &&
            allSegments.some(
              (segment) => segment.story === 'header' && segment.textMap.includes('Header outline')
            ) &&
            JSON.stringify(result.outOfRange).includes('invalid_input') &&
            JSON.stringify(result.outOfRange).includes('totalPages=3') &&
            result.empty.totalPages === 1 &&
            result.empty.segments.length === 0,
          {
            name: 'docx-outline-segment-pages',
            message: 'DOCX outline 应按每页 12 个 segment 分页，并完整覆盖所有根节点。',
            data: result
          }
        )
      }
    })
  })
})
