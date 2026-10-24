import { t } from '../../i18n'
import { useCallback, useContext, useMemo } from 'react'
import { DocumentSelectionContext } from '../workbench/composer/DocumentSelectionContext'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { markdownAdapter } from './selection/textFileAdapter'
import React, { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Empty, Spin } from 'antd'
import { useEditableTextFile } from './useEditableTextFile'
import MarkdownInput from './MarkdownInput'
import {
  hydrateMarkdownImages,
  isImageLoaded,
  revokeMarkdownImageBlobs,
  resolvePreviewImageName,
  type MarkdownImageBlobCache
} from './markdownImages'
import { openMarkdownEditorLink } from './markdownEditorLinks'
import ImageLightbox from '../workbench/ImageLightbox'
import type { ImageLightboxImage } from '../workbench/ImageLightbox'
import { workbenchSelectors } from '../../testing/selectors'

const MarkdownEditor: React.FC<{ filePath: string; allowSelection?: boolean }> = ({
  filePath,
  allowSelection = false
}) => {
  const { message } = AntdApp.useApp()
  const file = useEditableTextFile(filePath)
  const [selectionContainer, setSelectionContainer] = useState<HTMLDivElement | null>(null)
  const selectionState = useContext(DocumentSelectionContext)
  const selectionAdapter = useMemo(
    () => (selectionContainer ? markdownAdapter(selectionContainer, filePath, file.getText) : null),
    [selectionContainer, filePath, file.getText]
  )
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bindRoot = useCallback((element: HTMLDivElement | null) => {
    rootRef.current = element
    setSelectionContainer(element)
  }, [])
  const filePathRef = useRef(filePath)
  const blobCacheRef = useRef<MarkdownImageBlobCache>(new Map())
  const hydrateTimerRef = useRef<number | null>(null)
  const previewHandlerRef = useRef<(img: HTMLImageElement) => void>(() => undefined)
  const linkHandlerRef = useRef<(element: Element) => void>(() => undefined)
  const [previewImage, setPreviewImage] = useState<ImageLightboxImage | null>(null)
  const { initialText, autoSave, flushSave } = file

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  useEffect(() => {
    previewHandlerRef.current = (img) => {
      if (!isImageLoaded(img)) {
        message.warning(t(($) => $.editors.couldNotLoadTheImage))
        return
      }
      setPreviewImage({
        name: resolvePreviewImageName(img),
        src: img.currentSrc || img.src
      })
    }
  }, [message])

  useEffect(() => {
    linkHandlerRef.current = (element) => {
      void openMarkdownEditorLink({
        element,
        markdownFilePath: filePathRef.current
      }).then((result) => {
        if (result.ok) return
        if (result.reason === 'missing') {
          message.warning(t(($) => $.common.linkUnavailable))
          return
        }
        message.warning(result.detail || t(($) => $.editors.couldNotOpenTheLink))
      })
    }
  }, [message])

  const scheduleHydrate = (): void => {
    const root = rootRef.current
    if (!root) return
    if (hydrateTimerRef.current !== null) window.clearTimeout(hydrateTimerRef.current)
    hydrateTimerRef.current = window.setTimeout(() => {
      hydrateTimerRef.current = null
      void hydrateMarkdownImages({
        root,
        markdownFilePath: filePathRef.current,
        cache: blobCacheRef.current
      })
    }, 80)
  }

  useEffect(() => {
    scheduleHydrate()
  }, [filePath, initialText])

  useEffect(
    () => () => {
      void flushSave().catch((error) =>
        console.error(
          t(($) => $.editors.couldNotSaveTheFile),
          error
        )
      )
      if (hydrateTimerRef.current !== null) {
        window.clearTimeout(hydrateTimerRef.current)
        hydrateTimerRef.current = null
      }
      revokeMarkdownImageBlobs(blobCacheRef.current)
    },
    [flushSave]
  )

  if (file.loadError || (!file.loading && file.initialText === null)) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={file.loadError || t(($) => $.editors.couldNotLoadTheFile)}
        />
      </div>
    )
  }

  // 仅在尚无内容时展示 Spin；已有内容时保持根节点挂载，避免拆掉 Vditor DOM 后无法重建
  if (file.loading && file.initialText === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Spin />
      </div>
    )
  }

  return (
    <>
      <MarkdownInput
        key={filePath}
        value={initialText ?? ''}
        onRoot={bindRoot}
        onChange={(value) => {
          autoSave(value)
          scheduleHydrate()
        }}
        onReady={scheduleHydrate}
        readOnly={file.readOnly || selectionState?.locked}
        testId={workbenchSelectors.markdownEditor}
        onImage={(element) => previewHandlerRef.current(element)}
        onLink={(element) => linkHandlerRef.current(element)}
      />
      {allowSelection && selectionAdapter && (
        <DocumentSelectionLayer
          container={selectionContainer}
          filePath={filePath}
          revision={1}
          adapter={selectionAdapter}
          testPrefix="text"
        />
      )}
      <ImageLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  )
}

export default React.memo(MarkdownEditor)
