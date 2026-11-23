import { useEffect, useState } from 'react'
import { Empty, Spin } from 'antd'
import { t } from '../../i18n'
import type { PreviewResource } from '../../../../shared/preview'

export default function HtmlPreview({
  filePath,
  revision
}: {
  filePath: string
  revision?: number
}) {
  const [resource, setResource] = useState<PreviewResource | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let cancelled = false
    let opened: PreviewResource | undefined
    setResource(null)
    setFailed(false)
    void window.api
      .previewHtmlOpen(filePath)
      .then((value) => {
        opened = value
        if (cancelled) {
          void window.api.previewResourceRelease(value.id)
          return
        }
        setResource(value)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (opened) void window.api.previewResourceRelease(opened.id).catch(() => {})
    }
  }, [filePath, revision])
  if (failed)
    return (
      <div className="flex h-full items-center justify-center">
        <Empty description={t(($) => $.editors.filePreviewUnavailable2)} />
      </div>
    )
  if (!resource)
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    )
  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      sandbox="allow-scripts"
      src={resource.url}
      title={t(($) => $.editors.htmlPreview)}
      data-testid="workbench-html-preview"
    />
  )
}
