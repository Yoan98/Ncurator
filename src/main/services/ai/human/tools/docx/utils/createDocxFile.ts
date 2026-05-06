import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType
} from 'docx'
import type { DocxCreateBlock } from '../types'

type DocxHeadingLevel = (typeof HeadingLevel)[keyof typeof HeadingLevel]

const toHeadingLevel = (level: number | undefined): DocxHeadingLevel => {
  switch (level) {
    case 2:
      return HeadingLevel.HEADING_2
    case 3:
      return HeadingLevel.HEADING_3
    case 4:
      return HeadingLevel.HEADING_4
    case 5:
      return HeadingLevel.HEADING_5
    case 6:
      return HeadingLevel.HEADING_6
    default:
      return HeadingLevel.HEADING_1
  }
}

const createTextRuns = (text: string): TextRun[] => {
  const normalized = String(text || '')
  const parts = normalized.split('\n')
  return parts.flatMap((part, index) => {
    const run = new TextRun(part)
    return index === 0 ? [run] : [new TextRun({ break: 1 }), run]
  })
}

const createParagraph = (text: string, headingLevel?: number): Paragraph =>
  new Paragraph({
    heading: typeof headingLevel === 'number' ? toHeadingLevel(headingLevel) : undefined,
    children: createTextRuns(text)
  })

const createTable = (rows: string[][]): Table =>
  new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    rows: rows.map(
      (row) =>
        new TableRow({
          children: row.map(
            (cellText) =>
              new TableCell({
                children: [createParagraph(cellText)]
              })
          )
        })
    )
  })

const createDocumentChildren = (blocks: readonly DocxCreateBlock[]) => {
  if (blocks.length === 0) {
    return [createParagraph('')]
  }

  return blocks.map((block) => {
    switch (block.type) {
      case 'heading':
        return createParagraph(block.text, block.level)
      case 'table':
        return createTable(block.rows)
      case 'paragraph':
      default:
        return createParagraph(block.text)
    }
  })
}

export const createDocxFile = async (input: {
  filePath: string
  blocks: readonly DocxCreateBlock[]
}): Promise<void> => {
  const document = new Document({
    sections: [
      {
        children: createDocumentChildren(input.blocks)
      }
    ]
  })

  await fs.mkdir(path.dirname(input.filePath), { recursive: true })
  const buffer = await Packer.toBuffer(document)
  await fs.writeFile(input.filePath, buffer)
}
