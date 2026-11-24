import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { runBackendCase } from '../../../../harness/backend/run-backend-case'
import {
  nativeDocx,
  runDocxLiveRound,
  successfulDocxCalls,
  jsonObjects,
  REL_NS,
  wordAttr,
  wordElements,
  wordText
} from '../../../../harness/backend/liveScenarios/docxLiveScenario'

const FIXTURE = 'tests/fixtures/workspace/项目方案.docx'
const CASE = 'human-docx-section-header-footer-live'
const sections = (doc: Document) =>
  wordElements(doc, 'sectPr').filter((s) =>
    ['body', 'pPr'].includes((s.parentNode as Element)?.localName)
  )
const child = (node: Element, name: string) =>
  Array.from(node.childNodes).find((n) => n.nodeType === 1 && (n as Element).localName === name) as
    | Element
    | undefined
async function band(
  doc: Awaited<ReturnType<typeof nativeDocx>>,
  ordinal: number,
  kind: 'header' | 'footer',
  variant = 'default'
) {
  const props = sections(doc.document)
  let relation = ''
  for (const section of props.slice(0, ordinal + 1)) {
    const ref = wordElements(section, kind + 'Reference').find(
      (r) => wordAttr(r, 'type') === variant
    )
    if (ref) relation = ref.getAttributeNS(REL_NS, 'id')
  }
  if (!relation) return null
  const rel = Array.from(
    (await doc.dom('word/_rels/document.xml.rels')).getElementsByTagName('Relationship')
  ).find((r) => r.getAttribute('Id') === relation)
  if (!rel) throw new Error('Missing header/footer relationship')
  const name = path.posix.normalize(path.posix.join('word', rel.getAttribute('Target')))
  return { name, xml: await doc.xml(name), dom: await doc.dom(name) }
}
async function verifyOuterFooters(
  before: Awaited<ReturnType<typeof nativeDocx>>,
  after: Awaited<ReturnType<typeof nativeDocx>>
) {
  const expected = (await band(before, 0, 'footer'))!
  for (const ordinal of [0, 2]) {
    const footer = (await band(after, ordinal, 'footer'))!
    expect(footer.xml).toBe(expected.xml)
    const header = await band(after, ordinal, 'header')
    expect(header ? wordText(header.dom) : '').toBe('')
    const relName = path.posix.join(
      path.posix.dirname(footer.name),
      '_rels',
      path.posix.basename(footer.name) + '.rels'
    )
    const rels = await after.dom(relName)
    const relationships = Array.from(rels.getElementsByTagName('Relationship'))
    expect(
      relationships.some((r) => r.getAttribute('Target') === 'https://example.org/project')
    ).toBe(true)
    for (const r of relationships.filter((r) => r.getAttribute('Type').endsWith('/image'))) {
      const target = path.posix.join(path.posix.dirname(footer.name), r.getAttribute('Target'))
      expect(await after.zip.file(target)?.async('nodebuffer')).toEqual(
        await before.zip.file(target)?.async('nodebuffer')
      )
    }
  }
}
function pageParagraph(document: Document) {
  return wordElements(document, 'p').find(
    (paragraph) =>
      wordElements(paragraph, 'instrText').some((text) =>
        /\bPAGE\b/.test(text.textContent ?? '')
      ) ||
      wordElements(paragraph, 'fldSimple').some((field) =>
        /\bPAGE\b/.test(wordAttr(field, 'instr'))
      )
  )
}
function verifyPage(doc: Document) {
  const props = sections(doc)
  expect(props).toHaveLength(3)
  const size = child(props[1]!, 'pgSz'),
    margins = child(props[1]!, 'pgMar')
  expect(wordAttr(size, 'orient')).toBe('landscape')
  expect(Math.abs(Number(wordAttr(size, 'w')) - 16838)).toBeLessThanOrEqual(2)
  expect(Math.abs(Number(wordAttr(size, 'h')) - 11906)).toBeLessThanOrEqual(2)
  for (const attr of ['left', 'right'])
    expect(Math.abs(Number(wordAttr(margins, attr)) - 1134)).toBeLessThanOrEqual(1)
  for (const index of [0, 2]) {
    expect(wordAttr(child(props[index]!, 'pgSz'), 'w')).toBe('11906')
    expect(wordAttr(child(props[index]!, 'pgMar'), 'left')).toBe('1440')
  }
}
describe('DOCX section formatting live', () => {
  it(
    CASE,
    async () =>
      runBackendCase({
        caseId: CASE,
        harnessMode: 'live',
        domain: 'ai',
        suite: 'human',
        groups: ['live'],
        description: '三轮自然语言修改节、页眉表格和页码，验证其他节共享页脚受保护。',
        fixtures: [FIXTURE],
        outputFiles: ['evidence/round-1.docx', 'evidence/round-2.docx', 'evidence/round-3.docx'],
        runMode: 'single',
        execute: async (runtime) => {
          const before = await nativeDocx(
            await fs.readFile(runtime.getFixtureWorkspacePath(FIXTURE))
          )
          const first = await runDocxLiveRound(
            runtime,
            FIXTURE,
            1,
            '把“验收安排”那部分改成 A4 横向，左右边距留 2 厘米。'
          )
          verifyPage((await nativeDocx(first.bytes)).document)
          const second = await runDocxLiveRound(
            runtime,
            FIXTURE,
            2,
            '这部分页眉加个两列表格，左边放项目名，右边写“内部评审”。页脚加居中的页码，从 1 开始。'
          )
          const middle = await nativeDocx(second.bytes)
          verifyPage(middle.document)
          const header = (await band(middle, 1, 'header'))!
          const table = wordElements(header.dom, 'tbl')[0]!
          expect(wordElements(table, 'tr')).toHaveLength(1)
          expect(wordElements(table, 'tc')).toHaveLength(2)
          expect(wordText(table)).toContain('星桥交付项目')
          expect(wordText(table)).toContain('内部评审')
          const footer = (await band(middle, 1, 'footer'))!
          const footerParagraph = pageParagraph(footer.dom)
          expect(footerParagraph).toBeDefined()
          expect(wordAttr(wordElements(footerParagraph!, 'jc')[0], 'val')).toBe('center')
          expect(wordAttr(child(sections(middle.document)[1]!, 'pgNumType'), 'start')).toBe('1')
          await verifyOuterFooters(before, middle)
          const third = await runDocxLiveRound(
            runtime,
            FIXTURE,
            3,
            '这部分第一页的页眉换成“评审稿”，页码接着前面排，其他部分别动。'
          )
          const final = await nativeDocx(third.bytes)
          verifyPage(final.document)
          const section = sections(final.document)[1]!
          expect(child(section, 'titlePg')).toBeDefined()
          expect(['0', 'false', 'off']).not.toContain(wordAttr(child(section, 'titlePg'), 'val'))
          expect(wordAttr(child(section, 'pgNumType'), 'start')).toBe('')
          expect(wordText((await band(final, 1, 'header', 'first'))!.dom)).toContain('评审稿')
          expect(wordText((await band(final, 1, 'header'))!.dom)).toContain('内部评审')
          for (const variant of ['default', 'first']) {
            const footerParagraph = pageParagraph((await band(final, 1, 'footer', variant))!.dom)
            expect(footerParagraph).toBeDefined()
            expect(wordAttr(wordElements(footerParagraph!, 'jc')[0], 'val')).toBe('center')
          }
          await verifyOuterFooters(before, final)
          const originalText = wordElements(before.document, 'p')
            .filter((p) => !wordElements(p, 'sectPr').length)
            .map(wordText)
          const finalText = wordElements(final.document, 'p')
            .filter((p) => !wordElements(p, 'sectPr').length)
            .map(wordText)
          expect(finalText).toEqual(originalText)
          const calls = successfulDocxCalls([...first.events, ...second.events, ...third.events])
          const names = [...new Set(calls.map((c) => c.toolName))]
          const required = [
            'docx_read_nodes',
            'docx_format',
            'docx_content_edit',
            'docx_table_edit'
          ]
          runtime.assertThat(
            required.every((n) => names.includes(n)) &&
              names.some((n) => ['docx_read_outline', 'docx_search'].includes(n)),
            {
              name: 'docx-section-tools-used',
              message: '模型实际成功使用节与页眉页脚读写工具。',
              data: { names }
            }
          )
          const sectionIds = new Set(
            calls
              .flatMap((c) => jsonObjects(c.data.sections).map((s) => s.nodeId))
              .concat(
                calls.flatMap((c) =>
                  jsonObjects(c.data.nodes)
                    .filter((n) => n.type === 'section')
                    .map((n) => n.nodeId)
                )
              )
          )
          const formats = calls.filter(
            (c) => c.toolName === 'docx_format' && c.input.type === 'format_section'
          )
          expect(formats.length).toBeGreaterThan(0)
          for (const call of formats) {
            expect(Array.isArray(call.input.nodeIds)).toBe(true)
            expect((call.input.nodeIds as string[]).every((id) => sectionIds.has(id))).toBe(true)
            expect(call.input.format).toBeTypeOf('object')
          }
          expect(
            calls.some(
              (c) =>
                c.toolName === 'docx_table_edit' &&
                c.input.type === 'create_table' &&
                ['inside_start', 'inside_end'].includes(String(c.input.position))
            )
          ).toBe(true)
          return true
        },
        assert: async (passed, runtime) => {
          runtime.assertThat(passed, {
            name: 'docx-section-three-round-result',
            message: '三轮页面、页眉页脚修改均落盘，正文及其他节内容保持正确。'
          })
        }
      }),
    1800000
  )
})
