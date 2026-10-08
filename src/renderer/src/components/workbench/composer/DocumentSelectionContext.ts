import { createContext } from 'react'
import type { DocumentSelectionNode } from '../../../../../shared/types'

export type SelectionLocation = { start: number; end: number; previewText: string }
export type DocumentSelectionState = {
  enabled: boolean
  locked: boolean
  selections: DocumentSelectionNode[]
  locations: Map<string, SelectionLocation>
  navigation: { node: DocumentSelectionNode; requestId: number } | null
  save: (node: DocumentSelectionNode, location: SelectionLocation) => void
  remove: (id: string) => void
  navigate: (node: DocumentSelectionNode) => void
}

export const DocumentSelectionContext = createContext<DocumentSelectionState | null>(null)
