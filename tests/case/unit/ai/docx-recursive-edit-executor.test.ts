import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { XMLSerializer } from '@xmldom/xmldom'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { applyDocxOps } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/opExecutor'
import {
  buildNodeIndex,
  buildDocumentNodeIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'

const fixturePath = path.resolve('tests/fixtures/workspace/灵感测试.docx')

describe('docx recursive edit executor', () => {
  it('reads and edits header stories and empty content controls in their original parts', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-story-test-'))
    const sourcePath = path.join(tempDir, 'stories.docx')
    await createDocxFile({
      filePath: sourcePath,
      nodes: [
        {
          type: 'paragraph',
          children: [{ type: 'run', children: [{ type: 'text', text: 'Body' }] }]
        }
      ]
    })
    const zip = await JSZip.loadAsync(await fs.readFile(sourcePath))
    const documentXml = await zip.file('word/document.xml')!.async('text')
    zip.file(
      'word/document.xml',
      documentXml.replace(
        '<w:sectPr>',
        '<w:sdt><w:sdtPr><w:tag w:val="empty"/></w:sdtPr><w:sdtContent/></w:sdt><w:sectPr>'
      )
    )
    const relationshipsPath = 'word/_rels/document.xml.rels'
    const relationshipsXml = await zip.file(relationshipsPath)!.async('text')
    zip.file(
      relationshipsPath,
      relationshipsXml.replace(
        '</Relationships>',
        '<Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>'
      )
    )
    zip.file(
      'word/header1.xml',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>Header</w:t></w:r></w:p></w:hdr>'
    )
    const source = await zip.generateAsync({ type: 'nodebuffer' })
    const bundle = await loadDocxBundle(source)
    const index = buildDocumentNodeIndex(bundle)
    const header = index.outline.find((node) => node.story.type === 'header')
    const control = index.outline.find((node) => node.type === 'content_control')
    expect(header?.text).toBe('Header')
    expect(control?.text).toBe('')
    const headerEdited = await applyDocxOps({
      buffer: source,
      ops: [
        {
          type: 'replace_text',
          nodeId: header!.nodeId,
          oldText: 'Header',
          newText: 'Updated header'
        }
      ]
    })
    const controlEdited = await applyDocxOps({
      buffer: headerEdited.buffer,
      ops: [
        {
          type: 'insert_nodes',
          nodeId: control!.nodeId,
          position: 'inside_end',
          nodes: [{ type: 'paragraph', text: 'Filled' }]
        }
      ]
    })
    const imagePath = path.join(tempDir, 'header-image.png')
    await fs.writeFile(
      imagePath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
        'base64'
      )
    )
    const mediaEdited = await applyDocxOps({
      buffer: controlEdited.buffer,
      ops: [
        {
          type: 'insert_image',
          nodeId: header!.nodeId,
          position: 'after',
          imagePath,
          widthCm: 1,
          heightCm: 1,
          altText: 'Header image'
        }
      ]
    })
    const afterBundle = await loadDocxBundle(mediaEdited.buffer)
    const after = buildDocumentNodeIndex(afterBundle)
    expect(
      after.outline.some((node) => node.story.type === 'header' && node.text === 'Updated header')
    ).toBe(true)
    expect(
      after.outline.some((node) => node.type === 'content_control' && node.text === 'Filled')
    ).toBe(true)
    expect([...after.visualsById.values()].some((visual) => visual.story.type === 'header')).toBe(
      true
    )
    const afterZip = await JSZip.loadAsync(mediaEdited.buffer)
    expect(await afterZip.file('word/_rels/header1.xml.rels')?.async('text')).toContain(
      '/relationships/image'
    )
  })

  it('keeps visuals while replacing visible text and nodes accidental visual deletion', async () => {
    const source = await fs.readFile(fixturePath)
    const beforeBundle = await loadDocxBundle(source)
    const before = buildNodeIndex(
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
            type: 'replace_node',
            nodeId: visual!.ownerNodeId,
            node: {
              type: 'paragraph',
              text: 'replacement'
            }
          }
        ]
      })
    ).rejects.toThrow('target contains visual content')

    const paragraph = before.outline.find(
      (node) => node.type === 'paragraph' && node.text.length >= 2
    )
    expect(paragraph?.type).toBe('paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') return
    const query = paragraph.text.slice(0, 2)
    const replaced = await applyDocxOps({
      buffer: source,
      ops: [{ type: 'replace_text', nodeId: paragraph.nodeId, oldText: query, newText: '测试替换' }]
    })
    const afterBundle = await loadDocxBundle(replaced.buffer)
    const after = buildNodeIndex(
      afterBundle.documentDom,
      afterBundle.relationshipTargets,
      afterBundle.relationshipTypes
    )
    expect(after.visualsById.size).toBe(before.visualsById.size)
    expect(after.outline.some((node) => node.text.includes('测试替换'))).toBe(true)
  })

  it('inserts a recursive node tree and applies node style in place', async () => {
    const source = await fs.readFile(fixturePath)
    const bundle = await loadDocxBundle(source)
    const index = buildNodeIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )
    const anchor = index.bodyNodeIds[0]!
    const inserted = await applyDocxOps({
      buffer: source,
      ops: [
        {
          type: 'insert_nodes',
          nodeId: anchor,
          position: 'after',
          nodes: [{ type: 'paragraph', text: '递归插入', styleId: 'Heading2' }]
        }
      ]
    })
    const nextBundle = await loadDocxBundle(inserted.buffer)
    const next = buildNodeIndex(
      nextBundle.documentDom,
      nextBundle.relationshipTargets,
      nextBundle.relationshipTypes
    )
    expect(next.bodyNodeIds).toHaveLength(index.bodyNodeIds.length + 1)
    expect(next.outline.some((node) => node.text === '递归插入')).toBe(true)
  })

  it('splits a matched run and validates style target types', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-style-unit-'))
    const filePath = path.join(tempDir, 'style.docx')
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'before MATCH after' }] }]
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const bundle = await loadDocxBundle(source)
      const index = buildNodeIndex(
        bundle.documentDom,
        bundle.relationshipTargets,
        bundle.relationshipTypes
      )
      const nodeId = index.bodyNodeIds[0]!
      const styled = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'format_text',
            nodeId,
            text: 'MATCH',
            format: { bold: true }
          },
          {
            type: 'format_paragraph',
            nodeId,
            format: { alignment: 'center' }
          }
        ]
      })
      const styledBundle = await loadDocxBundle(styled.buffer)
      const styledIndex = buildNodeIndex(
        styledBundle.documentDom,
        styledBundle.relationshipTargets,
        styledBundle.relationshipTypes
      )
      const detail = styledIndex.detailByNodeId.get(styledIndex.bodyNodeIds[0]!)
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
              type: 'format_table',
              nodeId: styledIndex.bodyNodeIds[0]!,
              format: { alignment: 'left' }
            }
          ]
        })
      ).rejects.toThrow('format patch type mismatch')
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
        nodes: [
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
      const beforeIndex = buildNodeIndex(bundle.documentDom)
      expect(beforeIndex.visualsById.size).toBe(1)

      const styled = await applyDocxOps({
        buffer: withVisual,
        ops: [
          {
            type: 'format_text',
            nodeId: beforeIndex.bodyNodeIds[0]!,
            text: 'ABCD',
            format: { bold: true }
          },
          {
            type: 'format_text',
            nodeId: beforeIndex.bodyNodeIds[1]!,
            text: 'MATCH',
            format: { italic: true }
          }
        ]
      })
      const styledBundle = await loadDocxBundle(styled.buffer)
      const styledIndex = buildNodeIndex(styledBundle.documentDom)
      expect(styledIndex.visualsById.size).toBe(1)
      const details = styledIndex.bodyNodeIds.map((id) => styledIndex.detailByNodeId.get(id))
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

  it('edits run content with stable node targets and inserts native inline nodes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-content-node-unit-'))
    const filePath = path.join(tempDir, 'content.docx')
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'Alpha Beta' }] }]
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const sourceBundle = await loadDocxBundle(source)
      const sourceIndex = buildNodeIndex(
        sourceBundle.documentDom,
        sourceBundle.relationshipTargets,
        sourceBundle.relationshipTypes
      )
      const runId = [...sourceIndex.editableNodesById.values()].find(
        (node) => node.kind === 'run'
      )?.nodeId
      expect(runId).toBeDefined()
      const replaced = await applyDocxOps({
        buffer: source,
        ops: [{ type: 'replace_text', nodeId: runId!, oldText: 'Beta', newText: 'Gamma' }]
      })
      const replacedBundle = await loadDocxBundle(replaced.buffer)
      const replacedIndex = buildNodeIndex(
        replacedBundle.documentDom,
        replacedBundle.relationshipTargets,
        replacedBundle.relationshipTypes
      )
      const nextRunId = [...replacedIndex.editableNodesById.values()].find(
        (node) => node.kind === 'run'
      )?.nodeId
      const inserted = await applyDocxOps({
        buffer: replaced.buffer,
        ops: [
          {
            type: 'insert_nodes',
            nodeId: nextRunId!,
            position: 'after',
            nodes: [
              { type: 'hyperlink', text: ' OpenAI', target: 'https://openai.com' },
              { type: 'field', instruction: 'DATE', displayText: ' 2026-08-25' },
              { type: 'break', kind: 'line' }
            ]
          }
        ]
      })
      const finalBundle = await loadDocxBundle(inserted.buffer)
      const finalIndex = buildNodeIndex(
        finalBundle.documentDom,
        finalBundle.relationshipTargets,
        finalBundle.relationshipTypes
      )
      expect(finalIndex.outline[0]?.text).toContain('Alpha Gamma OpenAI 2026-08-25')
      expect([...finalBundle.relationshipTypes.values()]).toContain(
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('writes native image relationships and Word comments without rebuilding the paragraph', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-media-comment-unit-'))
    const filePath = path.join(tempDir, 'media-comments.docx')
    const imagePath = path.join(tempDir, 'sample.svg')
    try {
      await fs.writeFile(
        imagePath,
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="#1677ff"/></svg>'
      )
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: '需要批注的文字' }] }]
          }
        ]
      })
      const source = await fs.readFile(filePath)
      const sourceBundle = await loadDocxBundle(source)
      const sourceIndex = buildNodeIndex(sourceBundle.documentDom)
      const paragraphId = sourceIndex.bodyNodeIds[0]!
      const withImage = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'insert_image',
            nodeId: paragraphId,
            position: 'after',
            imagePath,
            widthCm: 2,
            heightCm: 1,
            altText: '蓝色测试图片'
          }
        ]
      })
      const imageBundle = await loadDocxBundle(withImage.buffer)
      const imageIndex = buildNodeIndex(
        imageBundle.documentDom,
        imageBundle.relationshipTargets,
        imageBundle.relationshipTypes,
        imageBundle.relationshipTargetModes,
        imageBundle.availableRelationshipTargetIds
      )
      expect(imageIndex.visualsById.size).toBe(1)
      expect(Object.keys(imageBundle.zip.files).some((name) => name.endsWith('.svg'))).toBe(true)
      const withComment = await applyDocxOps({
        buffer: withImage.buffer,
        ops: [
          {
            type: 'add_comment',
            nodeId: imageIndex.bodyNodeIds[0]!,
            text: '批注',
            comment: '原生 Word 批注',
            author: 'NCurator'
          }
        ]
      })
      const commentsBundle = await loadDocxBundle(withComment.buffer)
      const commentsXml = await commentsBundle.zip.file('word/comments.xml')?.async('text')
      expect(commentsXml).toContain('原生 Word 批注')
      expect(new XMLSerializer().serializeToString(commentsBundle.documentDom)).toContain(
        'commentRangeStart'
      )
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })
})
