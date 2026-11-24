import fs from 'node:fs/promises'
import JSZip from 'jszip'
import { expect, it, describe } from 'vitest'
import { createDocxToolHarness, writeTestDocxFile } from '../../../../harness/backend/aiToolHarness'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'

describe('native annotations', () => {
  it('docx-annotation-records', async () => {
    await runBackendCase({
      caseId: 'docx-annotation-records',
      harnessMode: 'tool-real',
      domain: 'ai',
      suite: 'tool',
      groups: ['docx'],
      description: '验证批注锚点、跨段范围、格式和移动修订。',
      fixtures: [],
      runMode: 'single',
      execute: async (runtime) => {
        const sourcePath = await writeTestDocxFile(runtime.workspaceRoot, 'annotations.docx', [
          { type: 'paragraph', text: 'seed' }
        ])
        const zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
        const xml = await zip.file('word/document.xml')!.async('text')
        const p = (text: string) => '<w:p><w:r><w:t>' + text + '</w:t></w:r></w:p>'
        const body =
          '<w:del w:id="1">' +
          p('restored').replace(/w:t>/g, 'w:delText>') +
          '</w:del>' +
          '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>A</w:t></w:r></w:p><w:p><w:r><w:t>B</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>' +
          '<w:p><w:pPr><w:jc w:val="center"/><w:pPrChange w:id="2"><w:pPr><w:jc w:val="left"/></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr><w:b/><w:rPrChange w:id="3"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr><w:t>format</w:t></w:r></w:p>' +
          '<w:p><w:moveFromRangeStart w:id="8" w:name="move1"/><w:moveFrom w:id="9"><w:r><w:delText>Moved</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="8"/></w:p>' +
          '<w:p><w:moveToRangeStart w:id="10" w:name="move1"/><w:moveTo w:id="11"><w:r><w:t>Moved</w:t></w:r></w:moveTo><w:moveToRangeEnd w:id="10"/></w:p>' +
          '<w:p><w:pPr><w:rPr><w:ins w:id="12"/></w:rPr></w:pPr><w:r><w:t>Prefix</w:t></w:r></w:p>' +
          p('Suffix')
        zip.file(
          'word/document.xml',
          xml.replace(/<w:body>[\s\S]*?<w:sectPr/, '<w:body>' + body + '<w:sectPr')
        )
        zip.file(
          'word/comments.xml',
          '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
            Array.from(
              { length: 52 },
              (_, i) => '<w:comment w:id="' + i + '">' + p('same') + '</w:comment>'
            ).join('') +
            '</w:comments>'
        )
        await fs.writeFile(sourcePath, await zip.generateAsync({ type: 'nodebuffer' }))
        const harness = createDocxToolHarness(runtime)
        type Comment = {
          commentId: string
          anchorText: string
          anchorNodeIds: string[]
          parentCommentId?: string
        }
        const comments = (query: object = {}) =>
          harness.invoke<{ comments: Comment[]; nextCursor?: string }>('docx_read_annotations', {
            sourcePath,
            type: 'comments',
            ...query
          })
        const revisions = () =>
          harness.invoke<{ revisions: Array<{ revisionId: string; kind: string; text?: string }> }>(
            'docx_read_annotations',
            { sourcePath, type: 'revisions' }
          )
        const decide = (args: object) =>
          harness.invoke('docx_comments_revisions', { sourcePath, ...args })
        try {
          const first = await comments()
          expect(first.comments).toHaveLength(50)
          expect(first.comments[0]).toMatchObject({ anchorText: 'AB' })
          expect(first.comments[0]!.anchorNodeIds).toHaveLength(2)
          expect((await comments({ cursor: first.nextCursor })).comments).toHaveLength(2)
          const reply = await decide({ type: 'reply_comment', commentId: '0', comment: 'same' })
          expect(reply).toEqual({ createdIds: ['52'] })
          await expect(comments({ cursor: first.nextCursor })).rejects.toThrow('游标')
          const scoped = await comments({ nodeIds: first.comments[0]!.anchorNodeIds })
          expect(scoped.comments.map((c) => c.commentId)).toEqual(['0', '52'])
          expect(scoped.comments[1]!.parentCommentId).toBe('0')
          const found = await revisions()
          expect(found.revisions.map((r) => r.kind)).toEqual([
            'delete',
            'paragraph_format',
            'text_format',
            'move',
            'insert'
          ])
          expect(found.revisions[0]!.text).toBe('restored')
          const search = () =>
            harness.invoke<{ totalMatchCount: number }>('docx_search', {
              sourcePath,
              query: 'restored'
            })
          expect((await search()).totalMatchCount).toBe(0)
          const acceptPath = sourcePath.replace('annotations.docx', 'accept.docx')
          await fs.copyFile(sourcePath, acceptPath)
          await decide({ sourcePath: acceptPath, type: 'accept_all_revisions' })
          const accepted = await (await JSZip.loadAsync(await fs.readFile(acceptPath)))
            .file('word/document.xml')!
            .async('string')
          expect(accepted).toContain('w:val="center"')
          expect(accepted).toContain('<w:b')
          expect(accepted.match(/>Moved</g)).toHaveLength(1)
          expect(accepted).not.toContain('restored')
          expect(accepted).not.toMatch(/w:(?:rPrChange|pPrChange|moveFrom|moveTo)/)
          expect(await decide({ type: 'reject_all_revisions' })).toEqual({})
          expect((await revisions()).revisions).toEqual([])
          expect((await search()).totalMatchCount).toBe(1)
          const after = await (await JSZip.loadAsync(await fs.readFile(sourcePath)))
            .file('word/document.xml')!
            .async('string')
          expect(after).toContain('w:val="left"')
          expect(after).toContain('<w:i')
          expect(after).not.toContain('w:moveFrom')
          expect(after).toContain('Prefix</w:t></w:r><w:r><w:t>Suffix')
          const mixedZip = await JSZip.loadAsync(await fs.readFile(sourcePath))
          mixedZip.file(
            'word/document.xml',
            after.replace(
              '<w:body>',
              '<w:body><w:p><w:pPr><w:sectPr><w:sectPrChange w:id="81"><w:sectPr/></w:sectPrChange></w:sectPr></w:pPr><w:ins w:id="82"><w:r><w:t>pending</w:t></w:r></w:ins></w:p>'
            )
          )
          const mixedPath = sourcePath.replace('annotations.docx', 'mixed.docx')
          const original = await mixedZip.generateAsync({ type: 'nodebuffer' })
          await fs.writeFile(mixedPath, original)
          expect(
            await decide({ sourcePath: mixedPath, type: 'accept_all_revisions' })
          ).toHaveProperty('error')
          expect(await fs.readFile(mixedPath)).toEqual(original)
          return true
        } finally {
          await harness.release()
        }
      },
      assert: async (succeeded) => {
        expect(succeeded).toBe(true)
      }
    })
  })
})
