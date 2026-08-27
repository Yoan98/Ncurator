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
  fromPercent: number
  toPercent: number
  fromNodeIndex: number
  toNodeIndex: number
  totalRootCount: number
  segments: OutlineSegment[]
}

const coveredNodeCount = (segments: readonly OutlineSegment[]): number =>
  segments.reduce((total, segment) => total + segment.toNodeIndex - segment.fromNodeIndex + 1, 0)

describe('ai tool docx outline pagination backend', () => {
  it('docx-outline-pagination', async () => {
    await runBackendCase({
      caseId: 'docx-outline-pagination',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证 DOCX segment map 按根节点比例切分、覆盖、摘要预算、story 和分段上限。',
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
        const overflowPath = await writeTestDocxFile(
          runtime.workspaceRoot,
          'outline-overflow.docx',
          Array.from({ length: 50 }, (_, index) => ({
            type: 'table' as const,
            rows: [[`Table ${String(index + 1)}`]]
          }))
        )
        const harness = createDocxToolHarness(runtime)
        try {
          const full = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            fromPercent: 0,
            toPercent: 100
          })
          const head = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            fromPercent: 0,
            toPercent: 50
          })
          const tail = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath,
            fromPercent: 50,
            toPercent: 100
          })
          const empty = await harness.invoke<OutlineResult>('docx_read_outline', {
            sourcePath: emptyPath,
            fromPercent: 0,
            toPercent: 100
          })
          const overflow = await harness.invoke('docx_read_outline', {
            sourcePath: overflowPath,
            fromPercent: 0,
            toPercent: 100
          })
          return { full, head, tail, empty, overflow }
        } finally {
          await harness.release()
        }
      },
      assert: async (result, runtime) => {
        const unionSegments = [...result.head.segments, ...result.tail.segments]
        const unionKeys = new Set(
          unionSegments.map(
            (segment) =>
              `${segment.story}:${String(segment.fromNodeIndex)}:${String(segment.toNodeIndex)}`
          )
        )
        const fullKeys = new Set(
          result.full.segments.map(
            (segment) =>
              `${segment.story}:${String(segment.fromNodeIndex)}:${String(segment.toNodeIndex)}`
          )
        )
        runtime.assertThat(
          result.full.fromPercent === 0 &&
            result.full.toPercent === 100 &&
            result.full.totalRootCount === coveredNodeCount(result.full.segments) &&
            result.full.segments.length > 0 &&
            result.full.segments.length <= 48 &&
            result.full.segments.every((segment) => Array.from(segment.textMap).length <= 360) &&
            result.full.segments.some(
              (segment) =>
                segment.textMap.includes('表格 2x2') &&
                segment.fromNodeIndex === segment.toNodeIndex
            ) &&
            result.full.segments.some(
              (segment) => segment.story === 'header' && segment.textMap.includes('Header outline')
            ) &&
            !JSON.stringify(result.full).includes('nodeId') &&
            result.head.toPercent === 50 &&
            result.tail.fromPercent === 50 &&
            result.tail.segments.some((segment) => segment.textMap.includes('表格 2x2')) &&
            [...fullKeys].every((key) => unionKeys.has(key)) &&
            result.empty.totalRootCount === 0 &&
            result.empty.segments.length === 0 &&
            JSON.stringify(result.overflow).includes('invalid_input') &&
            JSON.stringify(result.overflow).includes('48'),
          {
            name: 'docx-outline-segment-percent-range',
            message: 'DOCX outline 应按根节点比例返回完整 segment，并在超过 48 段时拒绝。',
            data: result
          }
        )
      }
    })
  })
})
