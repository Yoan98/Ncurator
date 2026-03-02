import fs from 'node:fs/promises'
import * as mammoth from 'mammoth'
import { Document, Packer, Paragraph } from 'docx'

export type DocxEditOperation =
  | {
      type: 'replace_text'
      find: string
      replace: string
      replaceAll?: boolean
    }
  | {
      type: 'append_paragraph'
      text: string
    }

export type DocxInspection = {
  sourcePath: string
  text: string
  paragraphCount: number
  charCount: number
  preview: string
}

const clipText = (text: string, maxChars: number) => {
  const raw = String(text || '')
  if (raw.length <= maxChars) return raw
  return raw.slice(0, maxChars)
}

const splitParagraphs = (text: string): string[] => {
  const normalized = String(text || '').replace(/\r\n/g, '\n')
  return normalized
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
}

export const inspectDocx = async (sourcePath: string, previewChars = 1800): Promise<DocxInspection> => {
  const result = await mammoth.extractRawText({ path: sourcePath })
  const text = String(result.value || '')
  const paragraphs = splitParagraphs(text)
  return {
    sourcePath,
    text,
    paragraphCount: paragraphs.length,
    charCount: text.length,
    preview: clipText(text, previewChars)
  }
}

export const applyDocxEdits = (input: {
  currentText: string
  edits: DocxEditOperation[]
}): {
  updatedText: string
  appliedCount: number
  warnings: string[]
} => {
  let text = String(input.currentText || '')
  let appliedCount = 0
  const warnings: string[] = []

  for (const edit of input.edits) {
    if (edit.type === 'replace_text') {
      const find = String(edit.find || '')
      if (!find) {
        warnings.push('skip replace_text: empty find')
        continue
      }
      const replace = String(edit.replace || '')
      if (edit.replaceAll) {
        if (!text.includes(find)) {
          warnings.push(`replace_text not found: ${find}`)
          continue
        }
        text = text.split(find).join(replace)
        appliedCount += 1
      } else {
        const index = text.indexOf(find)
        if (index < 0) {
          warnings.push(`replace_text not found: ${find}`)
          continue
        }
        text = `${text.slice(0, index)}${replace}${text.slice(index + find.length)}`
        appliedCount += 1
      }
      continue
    }

    const paragraph = String(edit.text || '').trim()
    if (!paragraph) {
      warnings.push('skip append_paragraph: empty text')
      continue
    }
    const separator = text.trim().length > 0 ? '\n\n' : ''
    text = `${text}${separator}${paragraph}`
    appliedCount += 1
  }

  return {
    updatedText: text,
    appliedCount,
    warnings
  }
}

export const saveDocxFromText = async (input: {
  outputPath: string
  text: string
}): Promise<{ outputPath: string; byteSize: number }> => {
  const paragraphs = splitParagraphs(input.text)
  const doc = new Document({
    sections: [
      {
        children:
          paragraphs.length > 0 ? paragraphs.map((line) => new Paragraph(line)) : [new Paragraph('')]
      }
    ]
  })
  const buffer = await Packer.toBuffer(doc)
  await fs.writeFile(input.outputPath, buffer)
  return {
    outputPath: input.outputPath,
    byteSize: buffer.byteLength
  }
}
