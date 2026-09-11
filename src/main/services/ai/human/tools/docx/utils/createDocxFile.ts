import fs from 'node:fs/promises'
import path from 'node:path'
import { Document, Packer, Paragraph, TextRun } from 'docx'
import type { DocxCreateRootNode } from '../types'
import { loadDocxBundle } from '../adapters/ooxml/nodeIndex'
import { createNodeFromNode, createRelationshipWriter } from '../adapters/ooxml/createNodeDom'
import { childElements } from '../adapters/ooxml/dom'
import { XMLSerializer } from '@xmldom/xmldom'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

export const createDocxFile = async (input: {
  filePath: string
  nodes: readonly DocxCreateRootNode[]
}): Promise<void> => {
  const skeleton = new Document({
    sections: [{ children: [new Paragraph({ children: [new TextRun('')] })] }]
  })
  const bundle = await loadDocxBundle(await Packer.toBuffer(skeleton))
  const body = bundle.documentDom.getElementsByTagNameNS(WORD_NS, 'body').item(0)
  if (!body) throw new Error('generated DOCX has no document body')
  childElements(body)
    .filter((node) => node.localName !== 'sectPr')
    .forEach((node) => body.removeChild(node))
  const relationships = await createRelationshipWriter(bundle.zip)
  const nodes =
    input.nodes.length > 0
      ? input.nodes
      : [
          {
            type: 'paragraph',
            children: [{ type: 'run', children: [{ type: 'text', text: '' }] }]
          } as const
        ]
  const sectionProperties = childElements(body, 'sectPr')[0] || null
  nodes.forEach((node) =>
    body.insertBefore(
      createNodeFromNode(bundle.documentDom, node, relationships),
      sectionProperties
    )
  )
  await relationships.persist()
  bundle.zip.file('word/document.xml', new XMLSerializer().serializeToString(bundle.documentDom))
  const buffer = await bundle.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  await fs.mkdir(path.dirname(input.filePath), { recursive: true })
  await fs.writeFile(input.filePath, buffer)
}
