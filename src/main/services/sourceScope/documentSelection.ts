import path from 'node:path'
import fs from 'node:fs/promises'
import type { DocumentSelectionNode, ChatSubmitRequest } from '../../../shared/types'
import { MAX_EXCEL_SELECTION_CELLS } from '../../../shared/documentSelection'
import { getPartnerObjectsDir } from '../assets/WorkspaceAssetService'
import { WorkspaceObjectStore } from '../ai/fileChanges/WorkspaceObjectStore'

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
    if (ext !== '.docx' || !node.selectedText.trim() || node.image) fail()
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
      !['text', 'element', 'slide'].includes(a.mode) ||
      typeof a.revision !== 'string' ||
      !a.revision ||
      (a.mode !== 'slide' &&
        (typeof a.elementId !== 'string' || !a.elementId.startsWith(a.slideId + '#'))) ||
      (a.mode === 'text' &&
        (!node.selectedText.trim() ||
          !a.textRange ||
          !integer(a.textRange.start) ||
          !integer(a.textRange.end, a.textRange.start + 1)))
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
  if (node.image && (a.kind !== 'ppt' || a.mode === 'text')) fail()
}

const png = (bytes: Uint8Array): boolean =>
  bytes.length >= 24 &&
  bytes.length <= 20 * 1024 * 1024 &&
  Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))

export async function freezeSelectionImages(
  request: ChatSubmitRequest,
  nodes: DocumentSelectionNode[]
): Promise<void> {
  const entries = request.selectionImages || []
  if (!Array.isArray(entries) || new Set(entries.map((e) => e.id)).size !== entries.length) fail()
  const root = getPartnerObjectsDir(request.partnerId)
  const store = new WorkspaceObjectStore(root)
  for (const entry of entries) {
    const node = nodes.find((n) => n.id === entry.id)
    if (!node) throw new Error('引用图像没有对应选区')
    if (
      node.anchor?.kind !== 'ppt' ||
      node.anchor.mode === 'text' ||
      !(entry.bytes instanceof Uint8Array) ||
      !png(entry.bytes)
    )
      fail()
    const result = await store.putBuffer(Buffer.from(entry.bytes))
    node.image = { path: result.objectPath, mimeType: 'image/png' }
  }
  for (const node of nodes) {
    if (node.anchor?.kind === 'ppt' && node.anchor.mode !== 'text' && !node.image) fail()
    if (!node.image) continue
    const relative = path.relative(root, node.image.path).split(path.sep).join('/')
    if (
      node.image.mimeType !== 'image/png' ||
      !/^sha256\/[a-f0-9]{2}\/[a-f0-9]{62}$/.test(relative)
    )
      fail()
    if (!png(await fs.readFile(node.image.path))) fail()
  }
}
