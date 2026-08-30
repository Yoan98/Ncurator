import React, { useEffect, useMemo, useState } from 'react'
import type { AiFileChangeRecord } from '../../../../shared/types'
import { assertSupportedPptDiffManifest } from '../../../../shared/pptDiffManifest'
import { workbenchSelectors } from '../../testing/selectors'
import PptSlideDeckViewer, { type PptViewerSlide } from '../fileRenders/PptSlideDeckViewer'

type DiffFrame = { index: number; svg: string }
type DiffSlide = {
  slideId: string
  changed: boolean
  changes: Array<'added' | 'deleted' | 'modified' | 'moved'>
  elementChanges: Array<{
    kind: 'added' | 'deleted' | 'modified'
    beforeElementId?: string
    afterElementId?: string
  }>
  positiveCount: number
  negativeCount: number
  before?: DiffFrame
  after?: DiffFrame
}
type DiffManifest = {
  version: 4
  operation: 'created' | 'updated'
  positiveCount: number
  negativeCount: number
  slides: DiffSlide[]
}

const loadLocalUrl = async (filePath: string): Promise<string> => {
  const bytes = await window.api.readFile(filePath)
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return URL.createObjectURL(new Blob([buffer], { type: 'image/svg+xml' }))
}

const changeLabel = (changes: DiffSlide['changes']): string => {
  if (changes.includes('deleted')) return '已删除'
  if (changes.includes('added')) return '新增页'
  if (changes.includes('moved') && changes.includes('modified')) return '内容已修改，位置已移动'
  if (changes.includes('moved')) return '位置已移动'
  if (changes.includes('modified')) return '内容已修改'
  return ''
}

const PptDiffViewer: React.FC<{ record: AiFileChangeRecord }> = ({ record }) => {
  const [manifest, setManifest] = useState<DiffManifest | null>(null)
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changedOnly, setChangedOnly] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setManifest(null)
    if (!record.previewPath) {
      setLoading(false)
      setError('缺少 PPT 审核内容')
      return () => undefined
    }
    void window.api
      .readFile(record.previewPath)
      .then((bytes) => JSON.parse(new TextDecoder().decode(bytes)) as DiffManifest)
      .then((next) => {
        if (cancelled) return
        assertSupportedPptDiffManifest(next)
        setManifest(next)
        setChangedOnly(next.operation === 'updated')
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [record.id, record.previewPath])

  useEffect(() => {
    if (!manifest) return () => undefined
    let cancelled = false
    const paths = [
      ...new Set(
        manifest.slides
          .flatMap((slide) => [slide.before?.svg, slide.after?.svg])
          .filter((value): value is string => Boolean(value))
      )
    ]
    const created: string[] = []
    void Promise.all(
      paths.map(async (filePath) => [filePath, await loadLocalUrl(filePath)] as const)
    )
      .then((entries) => {
        entries.forEach(([, url]) => created.push(url))
        if (!cancelled) setImageUrls(Object.fromEntries(entries))
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
      created.forEach((url) => URL.revokeObjectURL(url))
      setImageUrls({})
    }
  }, [manifest])

  const slides = useMemo<PptViewerSlide[]>(
    () =>
      (manifest?.slides || []).map((slide) => ({
        id: slide.slideId,
        index: slide.after?.index || slide.before?.index || 0,
        primaryUrl: slide.before ? imageUrls[slide.before.svg] : undefined,
        secondaryUrl: slide.after ? imageUrls[slide.after.svg] : undefined,
        label: changeLabel(slide.changes),
        marker: manifest?.operation === 'updated' ? slide.changes[0] : undefined
      })),
    [imageUrls, manifest]
  )
  const showFilter = manifest?.operation === 'updated' && slides.some((slide) => slide.marker)

  return (
    <PptSlideDeckViewer
      slides={slides}
      loading={loading}
      error={error}
      diff={manifest?.operation === 'updated'}
      filter={showFilter ? { changedOnly, onChange: setChangedOnly } : undefined}
      testId={workbenchSelectors.pptDiffViewer}
      beforeTestId={workbenchSelectors.pptDiffBefore}
      afterTestId={workbenchSelectors.pptDiffAfter}
      thumbnailsTestId={workbenchSelectors.pptDiffThumbnails}
      hintTestId={workbenchSelectors.pptViewerHint}
    />
  )
}

export default PptDiffViewer
