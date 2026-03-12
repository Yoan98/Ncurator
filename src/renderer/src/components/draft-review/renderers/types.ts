import type { ComponentType } from 'react'
import type { DraftDocumentFormat, DraftReviewChange, DraftReviewDocument } from '../../../../../shared/types'

export type DraftDiffRendererProps = {
  document: DraftReviewDocument
  change: DraftReviewChange | null
  onOpenPreview: (filePath: string, fileName: string) => void
}

export type DraftDiffRendererRegistration = {
  format: DraftDocumentFormat
  label: string
  component: ComponentType<DraftDiffRendererProps>
}
