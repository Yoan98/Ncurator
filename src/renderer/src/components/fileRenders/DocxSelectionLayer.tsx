import { useMemo } from 'react'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { createTextAdapter } from './selection/textAdapter'

export default function DocxSelectionLayer({
  container,
  filePath,
  revision
}: {
  container: HTMLDivElement | null
  filePath: string
  revision: number
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
    />
  ) : null
}
