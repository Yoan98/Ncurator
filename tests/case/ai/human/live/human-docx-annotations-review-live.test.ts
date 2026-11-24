import fs from 'node:fs/promises'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  nativeDocx,
  runDocxLiveRound,
  successfulDocxCalls,
  jsonObjects,
  wordAttr,
  wordElements,
  wordText
} from '../../../../harness/backend/liveScenarios/docxLiveScenario'

const FIXTURE = 'tests/fixtures/workspace/合同审阅.docx'
const CASE = 'human-docx-annotations-review-live'
const W15 = 'http://schemas.microsoft.com/office/word/2012/wordml'
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml'
const comments = async (doc: Awaited<ReturnType<typeof nativeDocx>>) =>
  wordElements(await doc.dom('word/comments.xml'), 'comment')
const revisions = (doc: Document) =>
  ['ins', 'del', 'rPrChange', 'pPrChange', 'moveFrom', 'moveTo'].flatMap((kind) =>
    wordElements(doc, kind).map((el) => ({ kind, id: wordAttr(el, 'id') }))
  )

describe('DOCX annotations live', () => {
  it(
    CASE,
    async () =>
      runBackendCase({
        caseId: CASE,
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '三轮自然语言查询批注修订、回复批注和按记录选择性审阅。',
        fixtures: [FIXTURE],
        outputFiles: ['evidence/round-1.docx', 'evidence/round-2.docx', 'evidence/round-3.docx'],
        runMode: 'single',
        execute: async (runtime) => {
          const initialBytes = await fs.readFile(runtime.getFixtureWorkspacePath(FIXTURE))
          const original = await nativeDocx(initialBytes)
          const originalComments = await comments(original)
          expect(originalComments).toHaveLength(52)
          const first = await runDocxLiveRound(
            runtime,
            FIXTURE,
            1,
            '帮我看看这份合同里的批注和修订，都在改什么。'
          )
          expect(first.bytes).toEqual(initialBytes)
          const reads = successfulDocxCalls(first.events).filter(
            (c) => c.toolName === 'docx_read_annotations'
          )
          const commentReads = reads.filter((c) => c.input.type === 'comments')
          const revisionReads = reads.filter((c) => c.input.type === 'revisions')
          const seenComments = new Set(
            commentReads.flatMap((c) => jsonObjects(c.data.comments).map((r) => r.commentId))
          )
          expect(seenComments.size).toBe(52)
          expect(revisionReads.length).toBeGreaterThan(0)
          expect(
            commentReads.some(
              (call, index) =>
                index > 0 &&
                commentReads
                  .slice(0, index)
                  .some(
                    (prev) => prev.data.nextCursor && call.input.cursor === prev.data.nextCursor
                  )
            )
          ).toBe(true)
          const records = revisionReads.flatMap((c) => jsonObjects(c.data.revisions))
          expect(records.map((r) => r.kind)).toEqual(
            expect.arrayContaining(['insert', 'delete', 'move', 'text_format', 'paragraph_format'])
          )
          const sameText = commentReads
            .flatMap((c) => jsonObjects(c.data.comments))
            .filter((c) => c.commentId === '0' || c.commentId === '50')
          expect(new Set(sameText.map((c) => c.commentId)).size).toBe(2)
          expect(new Set(sameText.map((c) => c.author)).size).toBe(2)
          const cross = commentReads
            .flatMap((c) => jsonObjects(c.data.comments))
            .find((c) => c.commentId === '49')!
          expect((cross.anchorNodeIds as string[]).length).toBe(2)
          const second = await runDocxLiveRound(
            runtime,
            FIXTURE,
            2,
            '王老师问验收时间那条，帮我回“按周五走”。'
          )
          const replied = await nativeDocx(second.bytes)
          const replyComments = await comments(replied)
          expect(replyComments).toHaveLength(53)
          const originalIds = new Set(originalComments.map((c) => wordAttr(c, 'id')))
          const reply = replyComments.find((c) => !originalIds.has(wordAttr(c, 'id')))!
          expect(wordText(reply)).toContain('按周五走')
          const paragraph = wordElements(reply, 'p').at(-1)!
          const target = replyComments.find((c) => wordAttr(c, 'id') === '50')!
          const parentPara = wordElements(target, 'p').at(-1)!.getAttributeNS(W14, 'paraId')
          const extended = await replied.dom('word/commentsExtended.xml')
          const thread = Array.from(extended.getElementsByTagNameNS(W15, 'commentEx')).find(
            (c) => c.getAttributeNS(W15, 'paraId') === paragraph.getAttributeNS(W14, 'paraId')
          )!
          expect(thread.getAttributeNS(W15, 'paraIdParent')).toBe(parentPara)
          const replyCalls = successfulDocxCalls(second.events).filter(
            (c) => c.toolName === 'docx_comments_revisions' && c.input.type === 'reply_comment'
          )
          expect(
            replyCalls.some(
              (c) =>
                c.input.commentId === '50' &&
                (c.data.createdIds as string[])?.includes(wordAttr(reply, 'id'))
            )
          ).toBe(true)
          const third = await runDocxLiveRound(
            runtime,
            FIXTURE,
            3,
            '金额和标题加粗的修改接受。风险提示被删、付款说明被挪位置、正文改居中，这几处都拒绝。弄完再检查一下。'
          )
          const final = await nativeDocx(third.bytes)
          expect(revisions(final.document)).toEqual([{ kind: 'ins', id: '120' }])
          const paragraphs = wordElements(final.document, 'p')
          const texts = paragraphs.map(wordText)
          expect(texts.some((s) => s.includes('合同总额为人民币120万元。'))).toBe(true)
          expect(texts).toContain('风险提示：接口联调通过不等于业务验收通过。')
          const payment = texts.indexOf('付款说明：验收签字后十个工作日内付清尾款。')
          expect(payment).toBeGreaterThan(texts.indexOf('付款条款'))
          expect(payment).toBeLessThan(texts.findIndex((s) => s.startsWith('验收说明')))
          expect(texts.filter((s) => s.startsWith('付款说明'))).toHaveLength(1)
          const title = paragraphs.find((p) => wordText(p) === '交付服务合同')!
          expect(wordElements(title, 'b').length).toBeGreaterThan(0)
          const acceptance = paragraphs.find((p) => wordText(p).startsWith('验收说明'))!
          expect(wordAttr(wordElements(acceptance, 'jc')[0], 'val')).toBe('left')
          const finalComments = await comments(final)
          expect(finalComments).toHaveLength(53)
          for (const originalComment of originalComments) {
            const current = finalComments.find(
              (c) => wordAttr(c, 'id') === wordAttr(originalComment, 'id')
            )!
            expect(wordText(current)).toBe(wordText(originalComment))
            expect(wordAttr(current, 'author')).toBe(wordAttr(originalComment, 'author'))
          }
          const allCalls = successfulDocxCalls([...first.events, ...second.events, ...third.events])
          const knownIds = new Set(
            allCalls
              .filter((c) => c.toolName === 'docx_read_annotations')
              .flatMap((c) => jsonObjects(c.data.revisions).map((r) => r.revisionId))
          )
          const decisions = allCalls.filter(
            (c) =>
              c.toolName === 'docx_comments_revisions' &&
              ['accept_revision', 'reject_revision'].includes(String(c.input.type))
          )
          expect(decisions.length).toBeGreaterThan(0)
          expect(decisions.every((c) => knownIds.has(c.input.revisionId))).toBe(true)
          const finalReads = successfulDocxCalls(third.events).filter(
            (c) => c.toolName === 'docx_read_annotations' && c.input.type === 'revisions'
          )
          expect(finalReads.at(-1)?.data.revisions).toEqual([
            expect.objectContaining({ revisionId: '120', kind: 'insert' })
          ])
          runtime.recordEvent({
            type: 'signal',
            name: 'docx-annotation-tool-coverage',
            status: 'info',
            message: '记录成功查询、续查和审阅操作。',
            data: {
              readCalls: reads.map((c) => c.input),
              decisions: decisions.map((c) => c.input),
              replyId: wordAttr(reply, 'id')
            }
          })
          return true
        },
        assert: async (passed, runtime) =>
          runtime.assertThat(passed, {
            name: 'docx-annotations-three-round-result',
            message: '批注完整续查、目标回复、删除恢复及格式和移动审阅均落盘。'
          })
      }),
    1800000
  )
})
