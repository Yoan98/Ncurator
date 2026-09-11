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
import {
  collectEditableNodeEntries,
  collectVisualNodeEntries
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/types'
import { createDocxFile } from '../../../../src/main/services/ai/human/tools/docx/utils/createDocxFile'

const fixturePath = path.resolve('tests/fixtures/workspace/灵感测试.docx')

describe('docx recursive edit executor', () => {
  it('keeps shared media until its final visual reference is deleted', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-shared-media-'))
    const filePath = path.join(tempDir, 'shared.docx')
    const imagePath = path.join(tempDir, 'pixel.png')
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'anchor' }] }]
          }
        ]
      })
      await fs.writeFile(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
          'base64'
        )
      )
      const source = await fs.readFile(filePath)
      const sourceIndex = buildDocumentNodeIndex(await loadDocxBundle(source))
      const paragraph = sourceIndex.outline[0]!
      const paragraphDetail = sourceIndex.detailByNodeId.get(paragraph.nodeId)
      if (!paragraphDetail || paragraphDetail.type !== 'paragraph') {
        throw new Error('paragraph fixture missing')
      }
      const runNode = paragraphDetail.children.find((node) => node.type === 'run')
      if (!runNode) throw new Error('run fixture missing')
      const withImage = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'replace_node',
            nodeId: runNode.nodeId,
            node: { type: 'visual', imagePath }
          }
        ]
      })
      const duplicatedBundle = await loadDocxBundle(withImage.buffer)
      const duplicatedIndex = buildDocumentNodeIndex(duplicatedBundle)
      const firstVisual = collectVisualNodeEntries(duplicatedIndex)[0]?.[1]
      const run = firstVisual ? removableVisualRun(firstVisual.node) : undefined
      if (!run?.parentNode) throw new Error('visual run missing')
      run.parentNode.insertBefore(run.cloneNode(true), run.nextSibling)
      const duplicated = await duplicatedBundle.zip.generateAsync({ type: 'nodebuffer' })
      const duplicatedWithXml = await JSZip.loadAsync(duplicated)
      duplicatedWithXml.file(
        'word/document.xml',
        new XMLSerializer().serializeToString(duplicatedBundle.documentDom)
      )
      const sharedSource = await duplicatedWithXml.generateAsync({ type: 'nodebuffer' })
      const sharedIndex = buildDocumentNodeIndex(await loadDocxBundle(sharedSource))
      const visuals = collectVisualNodeEntries(sharedIndex).map(([, visual]) => visual)
      expect(new Set(visuals.map((visual) => visual.nodeId)).size).toBe(2)

      const oneDeleted = await applyDocxOps({
        buffer: sharedSource,
        ops: [{ type: 'delete_node', nodeId: visuals[0]!.nodeId }]
      })
      const oneDeletedZip = await JSZip.loadAsync(oneDeleted.buffer)
      expect(oneDeletedZip.file('word/media/ncurator-1.png')).not.toBeNull()
      const remainingIndex = buildDocumentNodeIndex(await loadDocxBundle(oneDeleted.buffer))
      const remaining = collectVisualNodeEntries(remainingIndex)[0]?.[1]
      const allDeleted = await applyDocxOps({
        buffer: oneDeleted.buffer,
        ops: [{ type: 'delete_node', nodeId: remaining!.nodeId }]
      })
      expect((await JSZip.loadAsync(allDeleted.buffer)).file('word/media/ncurator-1.png')).toBeNull()
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('replaces ordinary nodes with visuals and visuals with ordinary nodes', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-node-type-replace-'))
    const filePath = path.join(tempDir, 'type-replace.docx')
    const imagePath = path.join(tempDir, 'pixel.png')
    const replacementImagePath = path.join(tempDir, 'replacement.png')
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: 'target' }] }]
          }
        ]
      })
      await fs.writeFile(
        imagePath,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nS8AAAAASUVORK5CYII=',
          'base64'
        )
      )
      await fs.copyFile(imagePath, replacementImagePath)
      const source = await fs.readFile(filePath)
      const before = buildDocumentNodeIndex(await loadDocxBundle(source))
      const detail = before.detailByNodeId.get(before.rootNodeIds[0]!)
      if (!detail || detail.type !== 'paragraph') throw new Error('paragraph fixture missing')
      const run = detail.children.find((node) => node.type === 'run')
      if (!run || run.type !== 'run') throw new Error('run fixture missing')

      const visualReplacement = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'replace_node',
            nodeId: run.nodeId,
            node: {
              type: 'visual',
              imagePath,
              widthCm: 1,
              heightCm: 1,
              altText: 'replacement image'
            }
          }
        ]
      })
      const withVisual = buildDocumentNodeIndex(await loadDocxBundle(visualReplacement.buffer))
      const visual = collectVisualNodeEntries(withVisual)[0]?.[1]
      expect(visual?.kind).toBe('image')
      expect(visual?.nodeId).not.toBe(run.nodeId)

      const imageReplaced = await applyDocxOps({
        buffer: visualReplacement.buffer,
        ops: [
          {
            type: 'replace_node',
            nodeId: visual!.nodeId,
            node: { type: 'visual', imagePath: replacementImagePath, altText: 'new image' }
          }
        ]
      })
      const replacedArchive = await JSZip.loadAsync(imageReplaced.buffer)
      expect(replacedArchive.file('word/media/ncurator-1.png')).toBeNull()
      expect(replacedArchive.file('word/media/ncurator-2.png')).not.toBeNull()
      const imageReplacedIndex = buildDocumentNodeIndex(await loadDocxBundle(imageReplaced.buffer))
      expect(collectVisualNodeEntries(imageReplacedIndex)[0]?.[1].nodeId).toBe(visual!.nodeId)

      const textReplacement = await applyDocxOps({
        buffer: imageReplaced.buffer,
        ops: [
          {
            type: 'replace_node',
            nodeId: visual!.nodeId,
            node: { type: 'run', text: 'restored text' }
          }
        ]
      })
      const afterBundle = await loadDocxBundle(textReplacement.buffer)
      const after = buildDocumentNodeIndex(afterBundle)
      expect(collectVisualNodeEntries(after)).toHaveLength(0)
      expect(after.outline[0]?.text).toContain('restored text')
      const restoredDetail = after.detailByNodeId.get(after.rootNodeIds[0]!)
      if (!restoredDetail || restoredDetail.type !== 'paragraph') {
        throw new Error('restored paragraph missing')
      }
      expect(restoredDetail.children.find((node) => node.type === 'run')?.nodeId).not.toBe(
        visual!.nodeId
      )
      const archive = await JSZip.loadAsync(textReplacement.buffer)
      const relationships = await archive.file('word/_rels/document.xml.rels')?.async('text')
      expect(relationships).not.toContain('/relationships/image')
      expect(
        Object.keys(archive.files).filter(
          (name) => name.startsWith('word/media/') && !archive.files[name]?.dir
        )
      ).toEqual([])
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

  it('allows destructive table edits without a visual-loss compatibility flag', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'docx-table-visual-safety-'))
    const filePath = path.join(tempDir, 'table.docx')
    try {
      await createDocxFile({
        filePath,
        nodes: [
          {
            type: 'table',
            children: ['A', 'B'].map((prefix) => ({
              type: 'table_row' as const,
              children: [`${prefix}1`, `${prefix}2`].map((text) => ({
                type: 'table_cell' as const,
                children: [
                  {
                    type: 'paragraph' as const,
                    children: [
                      { type: 'run' as const, children: [{ type: 'text' as const, text }] }
                    ]
                  }
                ]
              }))
            }))
          }
        ]
      })
      const zip = await JSZip.loadAsync(await fs.readFile(filePath))
      const xml = await zip.file('word/document.xml')!.async('text')
      zip.file('word/document.xml', xml.replace('<w:t>A2</w:t>', '<w:t>A2</w:t><w:drawing/>'))
      const source = await zip.generateAsync({ type: 'nodebuffer' })
      const bundle = await loadDocxBundle(source)
      const index = buildDocumentNodeIndex(bundle)
      const tableId = index.outline.find((node) => node.type === 'table')!.nodeId
      const detail = index.detailByNodeId.get(tableId)
      if (!detail || detail.type !== 'table') throw new Error('table detail missing')
      const firstRowId = detail.children[0]!.nodeId
      const deletedRow = await applyDocxOps({
        buffer: source,
        ops: [{ type: 'delete_row', rowNodeId: firstRowId }]
      })
      expect(deletedRow.buffer.byteLength).toBeGreaterThan(0)
      const deletedColumn = await applyDocxOps({
        buffer: source,
        ops: [{ type: 'delete_column', tableNodeId: tableId, columnIndex: 2 }]
      })
      expect(deletedColumn.buffer.byteLength).toBeGreaterThan(0)
      const merged = await applyDocxOps({
        buffer: source,
        ops: [
          {
            type: 'merge_cells',
            tableNodeId: tableId,
            fromRow: 1,
            fromColumn: 1,
            toRow: 1,
            toColumn: 2
          }
        ]
      })
      expect(merged.buffer.byteLength).toBeGreaterThan(0)
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true })
    }
  })

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
    expect(
      collectVisualNodeEntries(after).some(([, visual]) => visual.story.type === 'header')
    ).toBe(true)
    const headerVisual = collectVisualNodeEntries(after).find(
      ([, visual]) => visual.story.type === 'header'
    )?.[1]
    const bodyAnchor = after.outline.find((node) => node.story.type === 'body')
    await expect(
      applyDocxOps({
        buffer: mediaEdited.buffer,
        ops: [
          {
            type: 'move_node',
            nodeId: headerVisual!.nodeId,
            anchorNodeId: bodyAnchor!.nodeId,
            position: 'after'
          }
        ]
      })
    ).rejects.toThrow('cross-story move')
    const afterZip = await JSZip.loadAsync(mediaEdited.buffer)
    expect(await afterZip.file('word/_rels/header1.xml.rels')?.async('text')).toContain(
      '/relationships/image'
    )
  })

  it('keeps visuals for text replacement and allows explicit owner-node replacement', async () => {
    const source = await fs.readFile(fixturePath)
    const beforeBundle = await loadDocxBundle(source)
    const before = buildNodeIndex(
      beforeBundle.documentDom,
      beforeBundle.relationshipTargets,
      beforeBundle.relationshipTypes
    )
    const visual = collectVisualNodeEntries(before)[0]?.[1]
    expect(visual).toBeDefined()
    const ownerReplaced = await applyDocxOps({
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
    const ownerReplacedBundle = await loadDocxBundle(ownerReplaced.buffer)
    const ownerReplacedIndex = buildDocumentNodeIndex(ownerReplacedBundle)
    expect(collectVisualNodeEntries(ownerReplacedIndex).length).toBeLessThan(
      collectVisualNodeEntries(before).length
    )
    const beforeMedia = Object.keys((await JSZip.loadAsync(source)).files).filter((name) =>
      name.startsWith('word/media/')
    )
    const afterMedia = Object.keys((await JSZip.loadAsync(ownerReplaced.buffer)).files).filter(
      (name) => name.startsWith('word/media/')
    )
    expect(afterMedia.length).toBeLessThan(beforeMedia.length)

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
    expect(collectVisualNodeEntries(after)).toHaveLength(collectVisualNodeEntries(before).length)
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
    const anchor = index.rootNodeIds[0]!
    const inserted = await applyDocxOps({
      buffer: source,
      ops: [
        {
          type: 'insert_nodes',
          nodeId: anchor,
          position: 'after',
          nodes: [
            {
              type: 'paragraph',
              text: '递归插入',
              style: { styleId: 'Heading2', alignment: 'center' },
              runStyle: { bold: true }
            }
          ]
        }
      ]
    })
    const nextBundle = await loadDocxBundle(inserted.buffer)
    const next = buildNodeIndex(
      nextBundle.documentDom,
      nextBundle.relationshipTargets,
      nextBundle.relationshipTypes
    )
    expect(next.rootNodeIds).toHaveLength(index.rootNodeIds.length + 1)
    expect(next.outline.some((node) => node.text === '递归插入')).toBe(true)
    const insertedDetail = next.detailByNodeId.get(
      next.outline.find((node) => node.text === '递归插入')!.nodeId
    )
    expect(insertedDetail?.type).toBe('paragraph')
    if (insertedDetail?.type === 'paragraph') {
      expect(insertedDetail.style?.styleId).toBe('Heading2')
      expect(insertedDetail.style?.alignment).toBe('center')
      const runs = insertedDetail.children.filter((child) => child.type === 'run')
      expect(runs.some((run) => run.style?.bold === true)).toBe(true)
    }
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
      const nodeId = index.rootNodeIds[0]!
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
      const detail = styledIndex.detailByNodeId.get(styledIndex.rootNodeIds[0]!)
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
      const styledAllText = await applyDocxOps({
        buffer: styled.buffer,
        ops: [
          {
            type: 'format_text',
            nodeId: styledIndex.rootNodeIds[0]!,
            format: { italic: true }
          }
        ]
      })
      const styledAllBundle = await loadDocxBundle(styledAllText.buffer)
      const styledAllIndex = buildNodeIndex(styledAllBundle.documentDom)
      const styledAllDetail = styledAllIndex.detailByNodeId.get(styledAllIndex.rootNodeIds[0]!)
      expect(
        styledAllDetail?.type === 'paragraph'
          ? styledAllDetail.children
              .filter((child) => child.type === 'run')
              .every((run) => run.style?.italic === true)
          : false
      ).toBe(true)
      await expect(
        applyDocxOps({
          buffer: styled.buffer,
          ops: [
            {
              type: 'format_table',
              nodeId: styledIndex.rootNodeIds[0]!,
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
      expect(collectVisualNodeEntries(beforeIndex)).toHaveLength(1)

      const styled = await applyDocxOps({
        buffer: withVisual,
        ops: [
          {
            type: 'format_text',
            nodeId: beforeIndex.rootNodeIds[0]!,
            text: 'ABCD',
            format: { bold: true }
          },
          {
            type: 'format_text',
            nodeId: beforeIndex.rootNodeIds[1]!,
            text: 'MATCH',
            format: { italic: true }
          }
        ]
      })
      const styledBundle = await loadDocxBundle(styled.buffer)
      const styledIndex = buildNodeIndex(styledBundle.documentDom)
      expect(collectVisualNodeEntries(styledIndex)).toHaveLength(1)
      const details = styledIndex.rootNodeIds.map((id) => styledIndex.detailByNodeId.get(id))
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
      const runId = collectEditableNodeEntries(sourceIndex).find(
        ([, node]) => node.kind === 'run'
      )?.[1].nodeId
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
      const nextRunId = collectEditableNodeEntries(replacedIndex).find(
        ([, node]) => node.kind === 'run'
      )?.[1].nodeId
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
      const paragraphId = sourceIndex.rootNodeIds[0]!
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
      expect(collectVisualNodeEntries(imageIndex)).toHaveLength(1)
      expect(Object.keys(imageBundle.zip.files).some((name) => name.endsWith('.svg'))).toBe(true)
      const withComment = await applyDocxOps({
        buffer: withImage.buffer,
        ops: [
          {
            type: 'add_comment',
            nodeId: imageIndex.rootNodeIds[0]!,
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

const removableVisualRun = (node: Element): Element =>
  node.parentNode?.nodeType === 1 && (node.parentNode as Element).localName === 'r'
    ? (node.parentNode as Element)
    : node
