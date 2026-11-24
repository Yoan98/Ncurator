import fs from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { describe, it, expect } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('section-scoped footer tools', () => {
  it('docx-section-footers', async () => {
    await runBackendCase({
      caseId: 'docx-section-footers',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证按节创建和隔离共享页脚。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        let sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'sections.docx', [
          { type: 'paragraph', text: 'Body' }
        ])
        const harness = createDocxToolHarness(runtime)
        type Ref = { nodeId: string; state: string }
        const outline = () =>
          harness.invoke<{ sections: Ref[] }>('docx_read_outline', {
            sourcePath,
            fromPercent: 0,
            toPercent: 100
          })
        const read = (ids: string[]) =>
          harness.invoke<{ nodes: Array<Ref & { footers: Ref[]; children: Ref[] }> }>(
            'docx_read_nodes',
            { sourcePath, range: { type: 'node_ids', nodeIds: ids } }
          )
        const insert = (nodeId: string, nodes: object[]) =>
          harness.invoke<{ createdIds: string[] }>('docx_content_edit', {
            sourcePath,
            type: 'insert_nodes',
            position: 'inside_end',
            nodeId,
            nodes
          })
        const real = process.env.DOCX_QA_SOURCE
        try {
          if (real) await fs.copyFile(real, sourcePath)
          const section = (await outline()).sections[0]!
          const footer = (await read([section.nodeId])).nodes[0]!.footers[0]!
          const paragraph = await insert(footer.nodeId, [
            { type: 'paragraph', text: '', style: { alignment: 'center' } }
          ])
          expect(paragraph).toMatchObject({ createdIds: [expect.any(String)] })
          expect(
            await insert(paragraph.createdIds[0]!, [
              { type: 'run', text: '第 ' },
              { type: 'field', instruction: 'PAGE', displayText: '1' },
              { type: 'run', text: ' 页' }
            ])
          ).not.toHaveProperty('error')
          expect(JSON.stringify(await read([footer.nodeId]))).toContain('"instruction":"PAGE"')
          if (real)
            await fs.copyFile(
              sourcePath,
              path.join(process.env.TMPDIR || '/tmp', 'ncurator-footer-qa.docx')
            )
          // Exercise the native relationships on a copy after the production PAGE evidence is saved.
          const pixel = path.join(runtime.workspaceRoot, 'footer.png')
          await fs.writeFile(
            pixel,
            Buffer.from(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqi8AAAAASUVORK5CYII=',
              'base64'
            )
          )
          expect(
            await insert(paragraph.createdIds[0]!, [
              { type: 'hyperlink', target: 'https://example.org/footnote', text: '来源' }
            ])
          ).not.toHaveProperty('error')
          expect(
            await insert(paragraph.createdIds[0]!, [
              { type: 'visual', imagePath: pixel, altText: 'footer-logo' }
            ])
          ).not.toHaveProperty('error')
          const zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
          const xml = await zip.file('word/document.xml')!.async('text')
          const sectionXml = xml.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/)?.[0]
          expect(sectionXml).toBeTruthy()
          zip.file(
            'word/document.xml',
            xml.replace(
              sectionXml!,
              '<w:p><w:pPr>' +
                sectionXml +
                '</w:pPr></w:p><w:p><w:pPr><w:sectPr/></w:pPr></w:p><w:sectPr/>'
            )
          )
          sourcePath = path.join(runtime.workspaceRoot, 'shared-footer.docx')
          await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
          const sections = (await outline()).sections
          expect(sections.length).toBe(3)
          const slots = (await read(sections.map((s) => s.nodeId))).nodes.map((s) => s.footers[0]!)
          expect(slots.map((s) => s.state)).toEqual(['local', 'inherited', 'inherited'])
          const shared = await harness.invoke<{ matches: Ref[] }>('docx_search', {
            sourcePath,
            query: ' 页'
          })
          const ambiguous = await harness.invoke('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: shared.matches.at(-1)!.nodeId,
            oldText: ' 页',
            newText: '页'
          })
          expect(ambiguous).toMatchObject({
            code: 'ambiguous_section',
            sectionNodeIds: sections.map((s) => s.nodeId)
          })
          const filtered = await harness.invoke<{
            matches: (Ref & { sectionNodeIds: string[] })[]
          }>('docx_search', { sourcePath, nodeIds: [slots[1]!.nodeId], query: ' 页' })
          expect(filtered.matches[0]!.sectionNodeIds).toEqual([sections[1]!.nodeId])
          const scoped = (await read([slots[1]!.nodeId])).nodes[0]!.children[0]!
          const mutation = await harness.invoke('docx_content_edit', {
            sourcePath,
            type: 'replace_text',
            nodeId: scoped.nodeId,
            oldText: '第',
            newText: '本节第'
          })
          expect(mutation).not.toHaveProperty('error')
          const final = (await read(slots.map((s) => s.nodeId))).nodes
          expect(final.map((node) => JSON.stringify(node).includes('本节第'))).toEqual([
            false,
            true,
            false
          ])
          const table = await harness.invoke<{ createdIds: string[] }>('docx_table_edit', {
            sourcePath,
            type: 'create_table',
            nodeId: slots[1]!.nodeId,
            position: 'inside_start',
            rows: [['Footer table']]
          })
          expect(table.createdIds).toHaveLength(1)
          expect((await read(table.createdIds)).nodes[0]).toMatchObject({ type: 'table' })
          for (const node of final) {
            expect(JSON.stringify(node)).toContain('https://example.org/footnote')
            expect(JSON.stringify(node)).toContain('footer-logo')
          }
          const applyFormat = (format: object) =>
            harness.invoke('docx_format', {
              sourcePath,
              type: 'format_section',
              nodeIds: [sections[1]!.nodeId],
              format
            })
          const landscape = {
            orientation: 'landscape',
            pageWidthPt: 800,
            pageHeightPt: 600,
            headerDistancePt: 24,
            footerDistancePt: 25,
            pageNumberStart: 3,
            differentFirstPage: true
          }
          expect(await applyFormat(landscape)).toEqual({})
          expect(await applyFormat({ orientation: 'landscape' })).toEqual({})
          expect((await read([sections[1]!.nodeId])).nodes[0]).toMatchObject({ format: landscape })
          expect(await applyFormat({ pageNumberStart: null })).toEqual({})
          expect((await read([sections[1]!.nodeId])).nodes[0]).toMatchObject({
            format: { pageNumberStart: null }
          })
          return true
        } finally {
          await harness.release()
        }
      },
      assert: async (passed) => {
        expect(passed).toBe(true)
      }
    })
  })
})
