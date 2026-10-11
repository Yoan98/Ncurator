import type { DocumentSelectionNode } from './types'

export const MAX_EXCEL_SELECTION_CELLS = 10_000
export const selectionPosition = (node: DocumentSelectionNode): string => {
  const a = node.anchor
  if (!a) return ''
  switch (a.kind) {
    case 'text':
      return `第 ${a.startLine}–${a.endLine} 行`
    case 'pdf':
      return a.startPage === a.endPage
        ? `第 ${a.startPage} 页`
        : `第 ${a.startPage}–${a.endPage} 页`
    case 'ppt':
      return `第 ${a.page} 页${a.elementId ? ` · ${a.elementId}` : ' · 整页'}`
    case 'excel':
      return `${a.sheetName}!${a.range}`
  }
}
export const selectionTooltip = (node: DocumentSelectionNode): string =>
  [selectionPosition(node), node.selectedText].filter(Boolean).join('\n')
