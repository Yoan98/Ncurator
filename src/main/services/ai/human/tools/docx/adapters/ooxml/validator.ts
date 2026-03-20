import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'
import type { DocxValidationProblem } from '../../types'

const REQUIRED_ENTRIES = ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']

const hasZipEntry = (zip: JSZip, name: string): boolean => {
  return Boolean(zip.file(name))
}

const parseXml = (text: string): Document => {
  return new DOMParser().parseFromString(text, 'application/xml')
}

const findRelationshipsProblems = async (zip: JSZip): Promise<DocxValidationProblem[]> => {
  const problems: DocxValidationProblem[] = []
  const relsFile = zip.file('word/_rels/document.xml.rels')
  if (!relsFile) return problems

  const relsText = await relsFile.async('text')
  if (!relsText) return problems
  const relsDoc = parseXml(relsText)
  const nodes = relsDoc.getElementsByTagName('Relationship')
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes.item(i)
    if (!node) continue
    const targetMode = node.getAttribute('TargetMode') || ''
    if (targetMode.toLowerCase() === 'external') continue
    const target = node.getAttribute('Target') || ''
    if (!target) continue
    const normalized = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\/+/, '')}`
    if (!hasZipEntry(zip, normalized)) {
      problems.push({
        code: 'rels_target_missing',
        message: `missing relationship target: ${normalized}`
      })
    }
  }
  return problems
}

export const validateDocxBuffer = async (buffer: Buffer): Promise<DocxValidationProblem[]> => {
  const problems: DocxValidationProblem[] = []
  const zip = await JSZip.loadAsync(buffer)

  for (const entry of REQUIRED_ENTRIES) {
    if (!hasZipEntry(zip, entry)) {
      problems.push({
        code: 'missing_entry',
        message: `required entry is missing: ${entry}`
      })
    }
  }

  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) {
    return problems
  }

  const docXmlText = await docXmlFile.async('text')
  if (!docXmlText) {
    problems.push({
      code: 'empty_document_xml',
      message: 'word/document.xml is empty'
    })
    return problems
  }

  const docDom = parseXml(docXmlText)
  const documentNode = docDom.getElementsByTagNameNS(
    'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
    'document'
  )
  if (documentNode.length === 0) {
    problems.push({
      code: 'invalid_document_xml',
      message: 'word/document.xml has no w:document root'
    })
  }

  const relProblems = await findRelationshipsProblems(zip)
  problems.push(...relProblems)
  return problems
}
