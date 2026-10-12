import { useMemo } from 'react'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { createTextAdapter } from './selection/textAdapter'
import type { SelectionTarget } from './selection/types'

export default function DocxSelectionLayer({
  container,
  filePath,
  revision,
  onTargetsChange
}: {
  container: HTMLDivElement | null
  filePath: string
  revision: number
  onTargetsChange?: (targets: SelectionTarget[]) => void
}) {
  const adapter = useMemo(
    () => (container ? createTextAdapter(container, filePath) : null),
    [container, filePath]
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
