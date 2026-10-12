import type { DocumentSelectionNode } from './types'

export const MAX_EXCEL_SELECTION_CELLS = 10_000

const PPT_SELECTION_MODE_LABEL = {
  element: '整个元素',
  slide: '整页'
} as const

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
      const parts = [
        `位置：第 ${anchor.page} 页 · ${PPT_SELECTION_MODE_LABEL[anchor.mode]}`,
        `页面标识：${anchor.slideId}`
      ]
      if (anchor.elementId) parts.push(`元素标识：${anchor.elementId}`)
      return parts.join('\n')
    }
    case 'excel':
      return `位置：${anchor.sheetName}!${anchor.range}`
  }
}

export const selectionTooltip = (node: DocumentSelectionNode): string =>
  [renderSelectionLocation(node), node.selectedText].filter(Boolean).join('\n')
