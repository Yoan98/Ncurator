import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { XMLSerializer } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import { applyDocxOps } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/opExecutor'
import {
  buildBlockIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/blockIndex'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'

const fixturePath = path.resolve('tests/fixtures/workspace/灵感测试.docx')

describe('docx recursive edit executor', () => {
  it('keeps visuals while replacing visible text and blocks accidental visual deletion', async () => {
    const source = await fs.readFile(fixturePath)
    const beforeBundle = await loadDocxBundle(source)
    const before = buildBlockIndex(
      beforeBundle.documentDom,
      beforeBundle.relationshipTargets,
      beforeBundle.relationshipTypes
    )
    const visual = [...before.visualsById.values()][0]
    expect(visual).toBeDefined()
    await expect(
      applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'replace_block',
            blockId: visual!.blockId,
            content: {
              type: 'paragraph',
              children: [{ type: 'run', children: [{ type: 'text', text: 'replacement' }] }]
            }
          }
        ]
      })
    ).rejects.toThrow('visual loss blocked')

    const paragraph = before.outline.find(
      (block) => block.type === 'paragraph' && block.text.length >= 2
    )
    expect(paragraph?.type).toBe('paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') return
    const query = paragraph.text.slice(0, 2)
    const replaced = await applyDocxOps({
      buffer: source,
      ops: [{ type: 'replace_text', query, replace: '测试替换' }]
    })
    const afterBundle = await loadDocxBundle(replaced.buffer)
    const after = buildBlockIndex(
      afterBundle.documentDom,
      afterBundle.relationshipTargets,
      afterBundle.relationshipTypes
    )
    expect(after.visualsById.size).toBe(before.visualsById.size)
    expect(after.outline.some((block) => block.text.includes('测试替换'))).toBe(true)
  })

  it('inserts a recursive block tree and applies node style in place', async () => {
    const source = await fs.readFile(fixturePath)
    const bundle = await loadDocxBundle(source)
    const index = buildBlockIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )
    const anchor = index.bodyBlockIds[0]!
    const inserted = await applyDocxOps({
      buffer: source,
      ops: [
        {
          type: 'insert_after',
          anchorBlockId: anchor,
          content: [
            {
              type: 'paragraph',
              style: { styleName: 'Heading2' },
              children: [
                {
                  type: 'run',
                  style: { bold: true },
                  children: [{ type: 'text', text: '递归插入' }]
                }
              ]
            }
          ]
        }
      ]
    })
    const nextBundle = await loadDocxBundle(inserted.buffer)
    const next = buildBlockIndex(
      nextBundle.documentDom,
      nextBundle.relationshipTargets,
      nextBundle.relationshipTypes
    )
    expect(next.bodyBlockIds).toHaveLength(index.bodyBlockIds.length + 1)
    expect(next.outline.some((block) => block.text === '递归插入')).toBe(true)
  })

  it('splits a matched run and validates style target types', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-unit-'))
    const filePath = path.join(tempDir, 'style.docx')
    try {
      await createDocxFile({
        filePath,
        blocks: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'before MATCH after' }] }]
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const bundle = await loadDocxBundle(source)
      const index = buildBlockIndex(
        bundle.documentDom,
        bundle.relationshipTargets,
        bundle.relationshipTypes
      )
      const blockId = index.bodyBlockIds[0]!
      const styled = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'style',
            target: { type: 'text_match', query: 'MATCH' },
            patch: { kind: 'run', bold: true }
          },
          {
            type: 'style',
            target: { type: 'id', id: blockId },
            patch: { kind: 'paragraph', alignment: 'center' }
          }
        ]
      })
      const styledBundle = await loadDocxBundle(styled.buffer)
      const styledIndex = buildBlockIndex(
        styledBundle.documentDom,
        styledBundle.relationshipTargets,
        styledBundle.relationshipTypes
      )
      const detail = styledIndex.detailByBlockId.get(styledIndex.bodyBlockIds[0]!)
      expect(detail?.type).toBe('paragraph')
      if (!detail || detail.type !== 'paragraph') return
      const runs = detail.children.filter((child) => child.type === 'run')
      expect(
        runs.map((run) =>
          run.children.map((child) => (child.type === 'text' ? child.text : '')).join('')
        )
      ).toEqual(['before ', 'MATCH', ' after'])
      expect(runs.map((run) => run.style?.bold)).toEqual([undefined, true, undefined])
      expect(detail.style?.alignment).toBe('center')
      await expect(
        applyDocxOps({
          buffer: styled.buffer,
          ops: [
            {
              type: 'style',
              target: { type: 'id', id: styledIndex.bodyBlockIds[0]! },
              patch: { kind: 'table', alignment: 'left' }
            }
          ]
        })
      ).rejects.toThrow('style patch type mismatch')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('styles exact text across runs and preserves a visual inside a multi-text run', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-visual-unit-'))
    const filePath = path.join(tempDir, 'style-visual.docx')
    try {
      await createDocxFile({
        filePath,
        blocks: [
          {
            type: 'paragraph',
            children: [
              { type: 'run', children: [{ type: 'text', text: 'leftAB' }] },
              { type: 'run', children: [{ type: 'text', text: 'CDright' }] }
            ]
          },
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'beforeMATCHafter' }] }]
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const bundle = await loadDocxBundle(source)
      const paragraphs = Array.from(bundle.documentDom.getElementsByTagName('w:p'))
      const visualRun = paragraphs[1]!.getElementsByTagName('w:r').item(0)!
      const originalText = visualRun.getElementsByTagName('w:t').item(0)!
      const before = bundle.documentDom.createElementNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'w:t'
      )
      before.appendChild(bundle.documentDom.createTextNode('before'))
      const drawing = bundle.documentDom.createElementNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'w:drawing'
      )
      const after = bundle.documentDom.createElementNS(
        'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'w:t'
      )
      after.appendChild(bundle.documentDom.createTextNode('MATCHafter'))
      visualRun.insertBefore(before, originalText)
      visualRun.insertBefore(drawing, originalText)
      visualRun.insertBefore(after, originalText)
      visualRun.removeChild(originalText)
      bundle.zip.file(
        'word/document.xml',
        new XMLSerializer().serializeToString(bundle.documentDom)
      )
      const withVisual = await bundle.zip.generateAsync({ type: 'nodebuffer' })
      const beforeIndex = buildBlockIndex(bundle.documentDom)
      expect(beforeIndex.visualsById.size).toBe(1)

      const styled = await applyDocxOps({
        buffer: withVisual,
        ops: [
          {
            type: 'style',
            target: { type: 'text_match', query: 'ABCD' },
            patch: { kind: 'run', bold: true }
          },
          {
            type: 'style',
            target: { type: 'text_match', query: 'MATCH' },
            patch: { kind: 'run', italic: true }
          }
        ]
      })
      const styledBundle = await loadDocxBundle(styled.buffer)
      const styledIndex = buildBlockIndex(styledBundle.documentDom)
      expect(styledIndex.visualsById.size).toBe(1)
      const details = styledIndex.bodyBlockIds.map((id) => styledIndex.detailByBlockId.get(id))
      const firstRuns = details[0]?.type === 'paragraph' ? details[0].children : []
      const secondRuns = details[1]?.type === 'paragraph' ? details[1].children : []
      const styledText = (runs: typeof firstRuns, style: 'bold' | 'italic') =>
        runs
          .filter((node) => node.type === 'run' && node.style?.[style])
          .flatMap((node) =>
            node.type === 'run'
              ? node.children.map((child) => (child.type === 'text' ? child.text : ''))
              : []
          )
          .join('')
      expect(styledText(firstRuns, 'bold')).toBe('ABCD')
      expect(styledText(secondRuns, 'italic')).toBe('MATCH')
      expect(details[1]?.text).toBe('beforeMATCHafter')
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
