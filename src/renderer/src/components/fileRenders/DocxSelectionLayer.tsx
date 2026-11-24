import type { SuperDoc } from 'superdoc'
import { useMemo } from 'react'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { createWordSelectionAdapter, type WordPointers } from './selection/superDocSelection'
import type { SelectionTarget } from './selection/types'

export default function DocxSelectionLayer({
  editor,
  pointers,
  container,
  filePath,
  revision,
  onTargetsChange
}: {
  editor?: SuperDoc
  pointers?: WordPointers
  container: HTMLDivElement | null
  filePath: string
  revision: number
  onTargetsChange?: (targets: SelectionTarget[]) => void
}) {
  const adapter = useMemo(
    () => (container ? createWordSelectionAdapter(container, filePath, pointers, editor) : null),
    [container, filePath, pointers, editor]
  )
  return adapter ? (
    <DocumentSelectionLayer
      container={container}
      filePath={filePath}
      revision={revision}
      adapter={adapter}
      testPrefix="docx"
      onTargetsChange={onTargetsChange}
    />
  ) : null
}
