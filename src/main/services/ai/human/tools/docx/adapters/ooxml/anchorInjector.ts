import type JSZip from 'jszip'
import { XMLSerializer } from '@xmldom/xmldom'
import { buildBlockIndex, loadDocxBundle } from './blockIndex'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const createTextRun = (doc: Document, text: string): Element => {
  const run = doc.createElementNS(WORD_NS, 'w:r')
  const t = doc.createElementNS(WORD_NS, 'w:t')
  t.setAttribute('xml:space', 'preserve')
  t.appendChild(doc.createTextNode(text))
  run.appendChild(t)
  return run
}

const clearChildren = (node: Element) => {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}

const replaceParagraphContentWithTag = (paragraph: Element, tag: string) => {
  const doc = paragraph.ownerDocument
  if (!doc) throw new Error('paragraph has no ownerDocument')

  const keptPPr = Array.from({ length: paragraph.childNodes.length })
    .map((_, idx) => paragraph.childNodes.item(idx))
    .find((node) => node && node.nodeType === 1 && (node as Element).localName === 'pPr')

  clearChildren(paragraph)
  if (keptPPr) paragraph.appendChild(keptPPr)
  paragraph.appendChild(createTextRun(doc, `{{${tag}}}`))
}

const replaceTableWithPlaceholderParagraph = (table: Element, tag: string) => {
  const doc = table.ownerDocument
  if (!doc) throw new Error('table has no ownerDocument')
  const parent = table.parentNode
  if (!parent || parent.nodeType !== 1) {
    throw new Error('table parent is not an element')
  }
  const placeholder = doc.createElementNS(WORD_NS, 'w:p')
  placeholder.appendChild(createTextRun(doc, `{{${tag}}}`))
  parent.replaceChild(placeholder, table)
}

const replaceCellWithPlaceholderParagraph = (cell: Element, tag: string) => {
  const doc = cell.ownerDocument
  if (!doc) throw new Error('table cell has no ownerDocument')
  clearChildren(cell)
  const paragraph = doc.createElementNS(WORD_NS, 'w:p')
  paragraph.appendChild(createTextRun(doc, `{{${tag}}}`))
  cell.appendChild(paragraph)
}

const writeDocumentXml = async (zip: JSZip, doc: Document): Promise<Buffer> => {
  const xml = new XMLSerializer().serializeToString(doc)
  zip.file('word/document.xml', xml)
  return await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
}

export const injectPatchTag = async (input: {
  buffer: Buffer
  blockId: string
  tagName: string
}): Promise<Buffer> => {
  const bundle = await loadDocxBundle(input.buffer)
  const index = buildBlockIndex(bundle.documentDom)
  const node = index.nodesById.get(input.blockId)
  if (!node) {
    throw new Error(`block not found: ${input.blockId}`)
  }

  if (node.kind === 'paragraph') {
    replaceParagraphContentWithTag(node.node, input.tagName)
    return await writeDocumentXml(bundle.zip, bundle.documentDom)
  }

  if (node.kind === 'table') {
    replaceTableWithPlaceholderParagraph(node.node, input.tagName)
    return await writeDocumentXml(bundle.zip, bundle.documentDom)
  }

  replaceCellWithPlaceholderParagraph(node.node, input.tagName)
  return await writeDocumentXml(bundle.zip, bundle.documentDom)
}
