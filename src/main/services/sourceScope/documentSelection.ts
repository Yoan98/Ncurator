import fs from 'node:fs/promises'
import { loadDocxBundle } from '../ai/human/tools/docx/adapters/ooxml/nodeIndex'
import path from 'node:path'
import type { DocumentSelectionNode } from '../../../shared/types'
import { MAX_EXCEL_SELECTION_CELLS } from '../../../shared/documentSelection'

const integer = (value: number, min = 0): boolean => Number.isSafeInteger(value) && value >= min
const fail = (): never => {
  throw new Error('文档选区无效，请重新选择')
}
export function validateDocumentSelection(node: DocumentSelectionNode): void {
  if (
    typeof node.id !== 'string' ||
    !node.id ||
    !integer(node.number, 1) ||
    typeof node.filePath !== 'string' ||
    !path.isAbsolute(node.filePath) ||
    typeof node.selectedText !== 'string' ||
    typeof node.contextBefore !== 'string' ||
    typeof node.contextAfter !== 'string' ||
    !Array.isArray(node.children) ||
    node.children.some((child) => !child || (child.kind !== 'text' && child.kind !== 'reference'))
  )
    fail()
  const ext = path.extname(node.filePath).toLowerCase()
  const a = node.anchor
  if (!a) {
    if (ext !== '.docx' || !node.selectedText.trim()) fail()
    return
  }
  if (a.kind === 'text') {
    if (
      !integer(a.start) ||
      !integer(a.end, a.start + 1) ||
      !integer(a.startLine, 1) ||
      !integer(a.endLine, a.startLine) ||
      typeof a.sourceText !== 'string' ||
      !a.sourceText ||
      !node.selectedText.trim() ||
      ['.docx', '.pdf', '.pptx', '.xlsx', '.xlsm', '.xltx', '.xltm'].includes(ext)
    )
      fail()
  } else if (a.kind === 'pdf') {
    if (
      ext !== '.pdf' ||
      !integer(a.startPage, 1) ||
      !integer(a.endPage, a.startPage) ||
      !integer(a.start) ||
      !integer(a.end) ||
      (a.startPage === a.endPage && a.end <= a.start) ||
      !node.selectedText.trim()
    )
      fail()
  } else if (a.kind === 'ppt') {
    if (
      ext !== '.pptx' ||
      typeof a.slideId !== 'string' ||
      !a.slideId ||
      !integer(a.page, 1) ||
      !['element', 'slide'].includes(a.mode) ||
      typeof a.revision !== 'string' ||
      !a.revision ||
      (a.mode !== 'slide' &&
        (typeof a.elementId !== 'string' || !a.elementId.startsWith(a.slideId + '#')))
    )
      fail()
  } else if (a.kind === 'excel') {
    if (
      !['.xlsx', '.xlsm', '.xltx', '.xltm'].includes(ext) ||
      typeof a.sheetId !== 'string' ||
      !a.sheetId ||
      typeof a.sheetName !== 'string' ||
      !a.sheetName ||
      typeof a.range !== 'string' ||
      !integer(a.startRow) ||
      !integer(a.endRow, a.startRow) ||
      !integer(a.startColumn) ||
      !integer(a.endColumn, a.startColumn) ||
      a.endRow >= 1_048_576 ||
      a.endColumn >= 16_384 ||
      (a.endRow - a.startRow + 1) * (a.endColumn - a.startColumn + 1) > MAX_EXCEL_SELECTION_CELLS
    )
      fail()
    const column = (index: number): string => {
      let out = ''
      for (let n = index + 1; n; n = Math.floor((n - 1) / 26))
        out = String.fromCharCode(65 + ((n - 1) % 26)) + out
      return out
    }
    const start = `${column(a.startColumn)}${a.startRow + 1}`,
      end = `${column(a.endColumn)}${a.endRow + 1}`
    if (a.range !== (start === end ? start : `${start}:${end}`)) fail()
  } else fail()
}

const compactText = (text: string) => text.replace(/\s+/gu, '')
/** Match rendered selections against the saved package, before creating a chat run. */
export async function readDocxSelectionStories(filePath: string): Promise<string[]> {
  const bundle = await loadDocxBundle(await fs.readFile(filePath))
  return bundle.stories.map(({ root }) =>
    compactText(
      Array.from(
        root.getElementsByTagNameNS(
          'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          't'
        )
      )
        .filter((t) => {
          for (let n = t.parentNode; n && n !== root; n = n.parentNode)
            if (['del', 'moveFrom', 'txbxContent'].includes((n as Element).localName)) return false
          return true
        })
        .map((t) => t.textContent)
        .join('')
    )
  )
}

export function verifySavedDocxSelection(node: DocumentSelectionNode, stories: string[]): void {
  const quote = compactText(node.selectedText)
  const before = compactText(node.contextBefore),
    after = compactText(node.contextAfter)
  let count = 0,
    matches = 0
  for (const story of stories) {
    for (let at = story.indexOf(quote); at >= 0; at = story.indexOf(quote, at + 1)) {
      count++
      if (story.slice(0, at).endsWith(before) && story.slice(at + quote.length).startsWith(after))
        matches++
    }
  }
  if (count !== 1 && matches !== 1) throw new Error('Word 选区已变化或无法唯一定位，请重新选择原文')
}
