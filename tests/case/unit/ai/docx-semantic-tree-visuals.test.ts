import fs from 'node:fs/promises'
import path from 'node:path'
import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { describe, expect, it } from 'vitest'
import {
  buildNodeIndex,
  loadDocxBundle
} from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/nodeIndex'
import { readParagraphStyle } from '../../../../src/main/services/ai/human/tools/docx/adapters/ooxml/semanticTree'
import { handleDocxWorkerRequest } from '../../../../src/main/services/ai/human/tools/docx/worker/docxWorker'
import { createReplaySnapshot } from '../../../../src/main/services/ai/human/tools/docx/review/replayTree'
import { projectDocxReadNodes } from '../../../../src/main/services/ai/human/tools/docx/publicReadTree'
import type { DocxReadContentNode } from '../../../../src/main/services/ai/human/tools/docx/nodeTypes'

const findVisualId = (nodes: readonly DocxReadContentNode[]): string => {
  for (const node of nodes) {
    if (node.type === 'visual') return node.visualId
    if ('children' in node) {
      const visualId = findVisualId(node.children)
      if (visualId) return visualId
    }
  }
  return ''
}

describe('docx recursive semantic tree visuals', () => {
  it('keeps content controls and revisions as real root nodes', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">
        <w:body>
          <w:sdt><w:sdtPr><w:tag w:val="scope"/></w:sdtPr><w:sdtContent>
            <w:p><w:r><w:t>A</w:t></w:r></w:p>
            <w:ins><w:p><w:r><w:t>B</w:t></w:r></w:p></w:ins>
          </w:sdtContent></w:sdt>
          <w:del><w:p><w:r><w:delText>deleted</w:delText></w:r></w:p></w:del>
          <mc:AlternateContent>
            <mc:Choice Requires="unsupported"><w:p><w:r><w:t>wrong</w:t></w:r></w:p></mc:Choice>
            <mc:Fallback><w:p><w:r><w:t>C</w:t></w:r></w:p></mc:Fallback>
          </mc:AlternateContent>
        </w:body>
      </w:document>`
    const index = buildNodeIndex(new DOMParser().parseFromString(xml, 'application/xml'))

    expect(
      index.outline.filter((node) => node.type !== 'table_cell').map((node) => node.text)
    ).toEqual(['A\nB', 'deleted', 'C'])
    expect(index.rootNodeCount).toBe(3)
    expect(
      projectDocxReadNodes([index.detailByNodeId.get('body:content_control:0')!])
    ).toMatchObject([
      {
        type: 'content_control',
        tag: 'scope',
        children: [
          {
            type: 'paragraph'
          },
          {
            type: 'revision',
            kind: 'insert'
          }
        ]
      }
    ])
  })

  it('omits absent direct paragraph style attributes instead of returning zeroes', () => {
    const xml = `
      <w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:pPr>
          <w:pStyle w:val="Normal" />
          <w:ind w:left="720" />
          <w:spacing w:after="120" />
        </w:pPr>
      </w:p>`
    const paragraph = new DOMParser().parseFromString(xml, 'application/xml').documentElement

    expect(readParagraphStyle(paragraph)).toEqual({
      styleId: 'Normal',
      indent: { left: 36 },
      spacing: { after: 6 }
    })
  })

  it('parses every visual kind from the real OOXML fixture', async () => {
    const fixture = path.resolve('tests/fixtures/workspace/docx-visual-kinds.docx')
    const bundle = await loadDocxBundle(await fs.readFile(fixture))
    const index = buildNodeIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )

    expect([...index.visualsById.values()].map((visual) => visual.kind)).toEqual([
      'image',
      'chart',
      'diagram',
      'shape',
      'embedded_object'
    ])
    const shape = [...index.visualsById.values()].find((visual) => visual.kind === 'shape')
    expect(shape).toBeDefined()
    const owner = shape ? index.detailByNodeId.get(shape.ownerNodeId) : undefined
    const descendants = owner ? [owner] : []
    const text: string[] = []
    while (descendants.length) {
      const node = descendants.pop()!
      if (node.type === 'text') text.push(node.text)
      if ('children' in node && node.children) descendants.push(...node.children)
    }
    expect(text).toContain('Shape textbox')
  })

  it('classifies all visual kinds, selects AlternateContent, and nests shape text', () => {
    const xml = `
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
        xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
        xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"
        xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram"
        xmlns:v="urn:schemas-microsoft-com:vml"
        xmlns:o="urn:schemas-microsoft-com:office:office">
        <w:body>
          <w:p><w:r><w:drawing><pic:pic><a:blip r:embed="rImage"/></pic:pic></w:drawing></w:r></w:p>
          <w:p><w:r><w:drawing><c:chart r:id="rChart"/></w:drawing></w:r></w:p>
          <w:p><w:r><w:drawing><dgm:relIds r:dm="rDiagram"/></w:drawing></w:r></w:p>
          <w:p><w:r><w:pict><v:shape><w:txbxContent><w:p><w:r><w:t>Shape text</w:t></w:r></w:p></w:txbxContent></v:shape></w:pict></w:r></w:p>
          <w:p><w:r><w:object><v:shape><v:imagedata r:id="rPreview"/></v:shape><o:OLEObject r:id="rOle"/></w:object></w:r></w:p>
          <w:p><w:r><mc:AlternateContent><mc:Choice Requires="unsupported"><w:drawing><c:chart r:id="bad"/></w:drawing></mc:Choice><mc:Fallback><w:drawing><pic:pic><a:blip r:embed="fallback"/></pic:pic></w:drawing></mc:Fallback></mc:AlternateContent></w:r></w:p>
        </w:body>
      </w:document>`
    const dom = new DOMParser().parseFromString(xml, 'application/xml')
    const index = buildNodeIndex(
      dom,
      new Map([
        ['rImage', 'media/image.png'],
        ['rChart', 'charts/chart1.xml'],
        ['rDiagram', 'diagrams/data1.xml'],
        ['rPreview', 'media/preview.png'],
        ['fallback', 'media/fallback.png']
      ])
    )

    expect([...index.visualsById.values()].map((visual) => visual.kind)).toEqual([
      'image',
      'chart',
      'diagram',
      'shape',
      'embedded_object',
      'image'
    ])
    expect(index.visualsById.size).toBe(6)
    expect(index.outline[3]?.text).toBe('Shape text')
    const shapeDetail = index.detailByNodeId.get(index.rootNodeIds[3]!)
    const shapeVisual =
      shapeDetail?.type === 'paragraph' && shapeDetail.children[0]?.type === 'run'
        ? shapeDetail.children[0].children[0]
        : undefined
    expect(shapeVisual?.type).toBe('visual')
    expect(shapeVisual?.type === 'visual' ? shapeVisual.children?.[0]?.type : undefined).toBe(
      'paragraph'
    )
  })

  it('keeps image visuals distinct from real empty paragraphs', async () => {
    const fixture = path.resolve('tests/fixtures/workspace/灵感测试.docx')
    const bundle = await loadDocxBundle(await fs.readFile(fixture))
    const index = buildNodeIndex(
      bundle.documentDom,
      bundle.relationshipTargets,
      bundle.relationshipTypes
    )
    const images = [...index.visualsById.values()].filter((visual) => visual.kind === 'image')
    const realEmptyParagraphs = index.outline.filter(
      (node) => node.type === 'paragraph' && node.text === '' && !node.visuals
    )
    expect(images).toHaveLength(18)
    expect(realEmptyParagraphs).toHaveLength(22)
    expect(new Set(images.map((visual) => visual.visualId)).size).toBe(18)
    const snapshot = createReplaySnapshot({
      packageFingerprint: 'fixture',
      outlineNodes: index.outline,
      detailedNodesById: index.detailByNodeId,
      rawXmlByNodeId: new Map(
        [...index.nodesById.entries()].map(([nodeId, node]) => [
          nodeId,
          new XMLSerializer().serializeToString(node.node)
        ])
      )
    })
    const bindings = snapshot.nodes.flatMap((node) => node.visuals.map((visual) => visual.visualId))
    expect(bindings).toHaveLength(18)
    expect(new Set(bindings).size).toBe(18)
    expect(snapshot.nodes.filter((node) => node.visuals.length).every((node) => node.rawXml)).toBe(
      true
    )
  })

  it.each([
    ['图形学.docx', 599],
    ['深度学习.docx', 1034]
  ])(
    'indexes all VML visuals in %s without flattening output',
    async (name, expected) => {
      const fixture = path.resolve('tests/fixtures/workspace/学习笔记', name)
      const bundle = await loadDocxBundle(await fs.readFile(fixture))
      const index = buildNodeIndex(
        bundle.documentDom,
        bundle.relationshipTargets,
        bundle.relationshipTypes
      )
      expect(index.visualsById.size).toBe(expected)
      expect(index.outline.every((node) => !('children' in node))).toBe(true)
    },
    15_000
  )

  it('resolves a public visualId to its package image bytes', async () => {
    const runId = `visual-unit-${String(Date.now())}`
    const sourcePath = path.resolve('tests/fixtures/workspace/灵感测试.docx')
    const open = await handleDocxWorkerRequest({
      requestId: 'open',
      runId,
      action: 'open',
      payload: { sourcePath }
    })
    expect(open.ok).toBe(true)
    if (!open.ok || open.payload.action !== 'open') return
    const outline = await handleDocxWorkerRequest({
      requestId: 'outline',
      runId,
      action: 'outline',
      payload: {
        docId: open.payload.docId,
        fromNodeIndex: 0,
        toNodeIndex: 100,
        includeCells: true
      }
    })
    expect(outline.ok).toBe(true)
    if (!outline.ok || outline.payload.action !== 'outline') return
    const owner = outline.payload.nodes.find((node) => node.visuals?.count)
    expect(owner).toBeDefined()
    if (!owner) return
    const detail = await handleDocxWorkerRequest({
      requestId: 'detail',
      runId,
      action: 'get_node',
      payload: { docId: open.payload.docId, nodeId: owner.nodeId }
    })
    expect(detail.ok).toBe(true)
    if (!detail.ok || detail.payload.action !== 'get_node') return
    const visualId = findVisualId(detail.payload.node.children)
    expect(visualId).not.toBe('')
    const visual = await handleDocxWorkerRequest({
      requestId: 'visual',
      runId,
      action: 'get_visual',
      payload: { docId: open.payload.docId, visualId }
    })
    expect(visual.ok).toBe(true)
    if (visual.ok && visual.payload.action === 'get_visual') {
      expect(visual.payload.mimeType).toMatch(/^image\//)
      expect(visual.payload.data?.byteLength).toBeGreaterThan(100)
    }
    await handleDocxWorkerRequest({
      requestId: 'release',
      runId,
      action: 'release_run',
      payload: {}
    })
  })
})
