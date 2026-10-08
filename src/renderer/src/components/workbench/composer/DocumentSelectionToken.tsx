import type { DocumentSelectionNode } from '../../../../../shared/types'
import { selectionLabel } from '../../../../../shared/chatContent'
import {
  INLINE_TOKEN_LABEL_CLASS_NAME,
  SELECTION_DOCUMENT_ICON_PATH,
  SELECTION_NUMBER_CLASS_NAME,
  SELECTION_TOKEN_CLASS_NAME,
  selectionFileName
} from './referenceVisuals'

export default function DocumentSelectionToken({
  node,
  onClick
}: {
  node: DocumentSelectionNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-role="document-selection-token"
      aria-label={selectionLabel(node)}
      title={selectionLabel(node) + '\n' + node.selectedText}
      className={SELECTION_TOKEN_CLASS_NAME}
      onClick={onClick}
    >
      <svg
        viewBox="0 0 18 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="relative top-[0.1em] h-[1em] w-[1em] shrink-0 self-center"
      >
        <path d={SELECTION_DOCUMENT_ICON_PATH} />
      </svg>
      <span className={INLINE_TOKEN_LABEL_CLASS_NAME}>{selectionFileName(node)}</span>
      <span className={SELECTION_NUMBER_CLASS_NAME}>{node.number}</span>
    </button>
  )
}
