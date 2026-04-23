import { childElements, firstChildElement } from '../adapters/ooxml/dom'
import type { DocxBlockSpec, DocxParagraphSpec } from '../types'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const setWordAttribute = (node: Element, localName: string, value: string): void => {
  node.setAttribute(`w:${localName}`, value)
}

const cloneElement = (node: Element): Element => node.cloneNode(true) as Element

const clearChildren = (node: Element): void => {
  while (node.firstChild) {
    node.removeChild(node.firstChild)
  }
}

const getOrCreateChild = (node: Element, localName: string): Element => {
  const existing = firstChildElement(node, localName)
  if (existing) return existing
  const created = node.ownerDocument.createElementNS(WORD_NS, `w:${localName}`)
  node.insertBefore(created, node.firstChild)
  return created
}

const createTextRun = (
  doc: Document,
  text: string,
  prototypeRun?: Element | null
): Element => {
  const run = prototypeRun ? cloneElement(prototypeRun) : doc.createElementNS(WORD_NS, 'w:r')
  clearChildren(run)
  const rPr = prototypeRun ? firstChildElement(prototypeRun, 'rPr') : null
  if (rPr) run.appendChild(cloneElement(rPr))

  const parts = String(text || '').split('\n')
  parts.forEach((part, index) => {
    if (index > 0) run.appendChild(doc.createElementNS(WORD_NS, 'w:br'))
    const textNode = doc.createElementNS(WORD_NS, 'w:t')
    textNode.setAttribute('xml:space', 'preserve')
    textNode.appendChild(doc.createTextNode(part))
    run.appendChild(textNode)
  })
  return run
}

export const createParagraphElementFromSpec = (
  doc: Document,
  spec: DocxParagraphSpec,
  prototypeParagraph?: Element | null
): Element => {
  const paragraph = prototypeParagraph ? cloneElement(prototypeParagraph) : doc.createElementNS(WORD_NS, 'w:p')
  clearChildren(paragraph)

  const prototypePPr = prototypeParagraph ? firstChildElement(prototypeParagraph, 'pPr') : null
  if (prototypePPr) {
    paragraph.appendChild(cloneElement(prototypePPr))
  } else if (spec.style) {
    const pPr = doc.createElementNS(WORD_NS, 'w:pPr')
    const pStyle = doc.createElementNS(WORD_NS, 'w:pStyle')
    setWordAttribute(pStyle, 'val', spec.style)
    pPr.appendChild(pStyle)
    paragraph.appendChild(pPr)
  }

  const prototypeRuns = prototypeParagraph ? childElements(prototypeParagraph, 'r') : []
  const runs = spec.runs.length > 0 ? spec.runs : [{ text: '' }]
  runs.forEach((runSpec, index) => {
    const prototypeRun = prototypeRuns[index] || prototypeRuns[0] || null
    paragraph.appendChild(createTextRun(doc, String(runSpec.text || ''), prototypeRun))
  })

  return paragraph
}

export const createTableElementFromSpec = (
  doc: Document,
  spec: Extract<DocxBlockSpec, { kind: 'table' }>,
  prototypeTable?: Element | null
): Element => {
  if (prototypeTable) {
    const table = cloneElement(prototypeTable)
    const preservedTblPr = firstChildElement(table, 'tblPr')
    const preservedTblGrid = firstChildElement(table, 'tblGrid')
    clearChildren(table)
    if (preservedTblPr) table.appendChild(preservedTblPr)
    if (preservedTblGrid) table.appendChild(preservedTblGrid)
    spec.rows.forEach((rowSpec, rowIndex) => {
      const prototypeRow = childElements(prototypeTable, 'tr')[rowIndex]
      const row = prototypeRow ? cloneElement(prototypeRow) : doc.createElementNS(WORD_NS, 'w:tr')
      clearChildren(row)
      rowSpec.forEach((cellSpec, cellIndex) => {
        const prototypeCell = prototypeRow ? childElements(prototypeRow, 'tc')[cellIndex] : null
        const cell = prototypeCell ? cloneElement(prototypeCell) : doc.createElementNS(WORD_NS, 'w:tc')
        const tcPr = firstChildElement(cell, 'tcPr')
        clearChildren(cell)
        if (tcPr) cell.appendChild(tcPr)
        const prototypeParagraphs = prototypeCell ? childElements(prototypeCell, 'p') : []
        const paragraphs = cellSpec.paragraphs.length > 0
          ? cellSpec.paragraphs
          : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
        paragraphs.forEach((paragraphSpec, paragraphIndex) => {
          cell.appendChild(
            createParagraphElementFromSpec(
              doc,
              paragraphSpec,
              prototypeParagraphs[paragraphIndex] || prototypeParagraphs[0] || null
            )
          )
        })
        row.appendChild(cell)
      })
      table.appendChild(row)
    })
    return table
  }

  const table = doc.createElementNS(WORD_NS, 'w:tbl')
  const columnCount = Math.max(1, ...spec.rows.map((row) => row.length))
  const tableWidth = 9072
  const columnWidth = Math.max(720, Math.floor(tableWidth / columnCount))

  const tblPr = doc.createElementNS(WORD_NS, 'w:tblPr')
  const tblW = doc.createElementNS(WORD_NS, 'w:tblW')
  const tblLayout = doc.createElementNS(WORD_NS, 'w:tblLayout')
  setWordAttribute(tblW, 'w', String(tableWidth))
  setWordAttribute(tblW, 'type', 'dxa')
  setWordAttribute(tblLayout, 'type', 'fixed')
  tblPr.appendChild(tblW)
  tblPr.appendChild(tblLayout)
  table.appendChild(tblPr)

  const tblGrid = doc.createElementNS(WORD_NS, 'w:tblGrid')
  for (let index = 0; index < columnCount; index += 1) {
    const gridCol = doc.createElementNS(WORD_NS, 'w:gridCol')
    setWordAttribute(gridCol, 'w', String(columnWidth))
    tblGrid.appendChild(gridCol)
  }
  table.appendChild(tblGrid)

  spec.rows.forEach((rowSpec) => {
    const row = doc.createElementNS(WORD_NS, 'w:tr')
    rowSpec.forEach((cellSpec) => {
      const cell = doc.createElementNS(WORD_NS, 'w:tc')
      const tcPr = getOrCreateChild(cell, 'tcPr')
      const tcW = doc.createElementNS(WORD_NS, 'w:tcW')
      setWordAttribute(tcW, 'w', String(columnWidth))
      setWordAttribute(tcW, 'type', 'dxa')
      tcPr.appendChild(tcW)
      const paragraphs = cellSpec.paragraphs.length > 0
        ? cellSpec.paragraphs
        : [{ kind: 'paragraph' as const, style: 'Normal', runs: [{ text: '' }] }]
      paragraphs.forEach((paragraphSpec) => {
        cell.appendChild(createParagraphElementFromSpec(doc, paragraphSpec))
      })
      row.appendChild(cell)
    })
    table.appendChild(row)
  })

  return table
}

export const createBlockElementFromSpec = (
  doc: Document,
  spec: DocxBlockSpec,
  prototypeElement?: Element | null
): Element =>
  spec.kind === 'paragraph'
    ? createParagraphElementFromSpec(doc, spec, prototypeElement?.localName === 'p' ? prototypeElement : null)
    : createTableElementFromSpec(doc, spec, prototypeElement?.localName === 'tbl' ? prototypeElement : null)
