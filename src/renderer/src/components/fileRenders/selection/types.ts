import type { DocumentSelectionNode } from '../../../../../shared/types'
import type { SelectionLocation } from '../../workbench/composer/DocumentSelectionContext'
import type { SelectionRect } from './floatingLayout'

export type SelectionGeometry = {
  rects: () => SelectionRect[]
  ranges?: Range[]
  outline?: boolean
  reveal: () => void
}
export type SelectionCandidate = {
  node: DocumentSelectionNode
  location?: SelectionLocation
}
export type SelectionPopup = SelectionCandidate & { mode: 'action' | 'editor' }
export type SelectionAdapter = {
  capture: (event: PointerEvent | KeyboardEvent) => SelectionCandidate | null
  locate: (node: DocumentSelectionNode, saved?: SelectionLocation) => SelectionGeometry | null
  overlaps: (
    node: DocumentSelectionNode,
    candidate: SelectionCandidate,
    saved?: SelectionLocation
  ) => boolean
  /** Return true while changing page/sheet; navigation resumes after the surface updates. */
  navigate?: (node: DocumentSelectionNode) => boolean
  subscribe?: (refresh: () => void) => () => void
  paint?: (
    nodes: DocumentSelectionNode[],
    active: DocumentSelectionNode | undefined,
    hoverId: string | null
  ) => () => void
}
export const newSelection = (filePath: string, selectedText: string): DocumentSelectionNode => ({
  kind: 'document_selection',
  id: crypto.randomUUID(),
  number: 0,
  filePath,
  selectedText,
  contextBefore: '',
  contextAfter: '',
  children: []
})
