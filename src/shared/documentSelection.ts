import type { DocumentSelectionNode } from './types'

export const MAX_EXCEL_SELECTION_CELLS = 10_000

export const renderSelectionLocation = (node: DocumentSelectionNode): string => {
  const anchor = node.anchor
  if (!anchor) return ''
  switch (anchor.kind) {
    case 'text':
      return anchor.startLine === anchor.endLine
        ? `位置：第 ${anchor.startLine} 行`
        : `位置：第 ${anchor.startLine}–${anchor.endLine} 行`
    case 'pdf':
      return anchor.startPage === anchor.endPage
        ? `位置：第 ${anchor.startPage} 页`
        : `位置：第 ${anchor.startPage}–${anchor.endPage} 页`
    case 'ppt': {
      return [
        `位置：第 ${anchor.page} 页`,
        anchor.mode === 'element' ? `选中元素：${anchor.elementId}` : `选中页面：${anchor.slideId}`
      ].join('\n')
    }
    case 'excel':
      return `位置：${anchor.sheetName}!${anchor.range}`
  }
}

export const selectionTooltip = (node: DocumentSelectionNode): string =>
  [renderSelectionLocation(node), node.selectedText].filter(Boolean).join('\n')
