import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const REVIEW = 'urn:ncurator:docx-review'
export const readReviewPart = async (
  buffer: Buffer,
  name = 'word/document.xml'
): Promise<Document> => {
  const zip = await JSZip.loadAsync(buffer)
  const entry = zip.file(name)
  if (!entry) throw new Error(`missing review part ${name}`)
  return new DOMParser().parseFromString(await entry.async('text'), 'application/xml')
}
export const elementChildren = (element: Element): Element[] =>
  Array.from(element.childNodes).filter((n) => n.nodeType === 1) as Element[]
export const reviewKind = (element: Element): string =>
  element.getAttributeNS(REVIEW, 'change') || ''
export const visibleText = (element: Element): string => {
  if (['t', 'delText'].includes(element.localName)) return element.textContent || ''
  if (element.localName === 'tab') return '\t'
  if (['br', 'cr'].includes(element.localName)) return '\n'
  return elementChildren(element).map(visibleText).join('')
}
export const projectReview = (element: Element, accept: boolean): Element | null => {
  if (reviewKind(element) === (accept ? 'deleted' : 'inserted')) return null
  const copy = element.cloneNode(false) as Element
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === 1) {
      const projected = projectReview(child as Element, accept)
      if (projected) copy.appendChild(projected)
    } else copy.appendChild(child.cloneNode(true))
  }
  return copy
}
export const storyText = (document: Document, accept?: boolean): string[] => {
  const body = document.getElementsByTagNameNS(W, 'body')[0] || document.documentElement
  return elementChildren(body)
    .filter((e) => e.localName !== 'sectPr')
    .flatMap((e) => {
      const projected = accept === undefined ? e : projectReview(e, accept)
      return projected ? [visibleText(projected)] : []
    })
}
export const reviewRuns = (
  document: Document
): Array<{ text: string; kind: string; xml: string }> =>
  Array.from(document.getElementsByTagNameNS(W, 'r')).map((run) => ({
    text: visibleText(run),
    kind: reviewKind(run),
    xml: run.toString()
  }))

/** A small OOXML package for algorithm tests; all integration tests use the public tools. */
export const reviewBuffer = async (
  body: string,
  extras: Record<string, string | Buffer> = {}
): Promise<Buffer> => {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  )
  zip.file(
    '_rels/.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="root" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  )
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}</w:body></w:document>`
  )
  zip.file(
    'word/_rels/document.xml.rels',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
  )
  for (const [name, value] of Object.entries(extras)) zip.file(name, value)
  return await zip.generateAsync({ type: 'nodebuffer' })
}
export const paragraphXml = (text: string, rPr = '', pPr = ''): string =>
  `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r>${rPr ? `<w:rPr>${rPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</w:t></w:r></w:p>`

export const storyStructure = (document: Document, accept?: boolean): string => {
  const body = document.getElementsByTagNameNS(W, 'body')[0] || document.documentElement
  const shape = (node: Element): object =>
    node.localName === 'p'
      ? { kind: 'p', text: visibleText(node) }
      : {
          kind: node.localName,
          children: elementChildren(node)
            .filter(
              (e) => !['tblPr', 'tblGrid', 'trPr', 'tcPr', 'sdtPr', 'sectPr'].includes(e.localName)
            )
            .map(shape)
        }
  const projected = accept === undefined ? body : projectReview(body, accept)!
  return JSON.stringify(
    elementChildren(projected)
      .filter((e) => e.localName !== 'sectPr')
      .map(shape)
  )
}
