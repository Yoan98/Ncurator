import React, { useEffect, useRef, useState } from 'react'
import { App as AntdApp, Empty, Spin } from 'antd'
import Vditor from 'vditor'
import 'vditor/dist/index.css'
import './markdownEditor.css'
import { useEditableTextFile } from './useEditableTextFile'
import { vditorI18n } from './vditorI18n'
import {
  hydrateMarkdownImages,
  isImageLoaded,
  revokeMarkdownImageBlobs,
  resolvePreviewImageName,
  type MarkdownImageBlobCache
} from './markdownImages'
import ImageLightbox from '../workbench/ImageLightbox'
import type { ImageLightboxImage } from '../workbench/ImageLightbox'
import { workbenchSelectors } from '../../testing/selectors'

const resolveVditorCdn = (): string => new URL('vditor', document.baseURI).href

const MarkdownEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const { message } = AntdApp.useApp()
  const file = useEditableTextFile(filePath)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
  const filePathRef = useRef(filePath)
  const blobCacheRef = useRef<MarkdownImageBlobCache>(new Map())
  const hydrateTimerRef = useRef<number | null>(null)
  const previewHandlerRef = useRef<(img: HTMLImageElement) => void>(() => undefined)
  const [previewImage, setPreviewImage] = useState<ImageLightboxImage | null>(null)
  const { initialText, autoSave, flushSave } = file

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  useEffect(() => {
    previewHandlerRef.current = (img) => {
      if (!isImageLoaded(img)) {
        message.warning('图片无法加载')
        return
      }
      setPreviewImage({
        name: resolvePreviewImageName(img),
        src: img.currentSrc || img.src
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
    if (initialText === null || !rootRef.current || vditorRef.current) return
    readyRef.current = false
    const vditor = new Vditor(rootRef.current, {
      mode: 'ir',
      lang: 'zh_CN',
      i18n: vditorI18n,
      toolbar: [],
      cache: { enable: false },
      value: initialText,
      cdn: resolveVditorCdn(),
      placeholder: '开始输入…',
      link: { isOpen: false },
      image: {
        preview: (element) => {
          previewHandlerRef.current(element as HTMLImageElement)
        }
      },
      preview: {
        delay: 80,
        hljs: { enable: true, lineNumber: false, style: 'a11y-light' },
        math: { engine: 'KaTeX' },
        markdown: { gfmAutoLink: true, footnotes: true }
      },
      input: (value) => {
        autoSave(value)
        scheduleHydrate()
      },
      after: () => {
        readyRef.current = true
        scheduleHydrate()
      }
    })
    vditorRef.current = vditor
  }, [initialText, autoSave])

  useEffect(() => {
    if (!readyRef.current || !vditorRef.current) return
    const current = vditorRef.current
    if (current.getValue() === initialText) return
    current.setValue(initialText ?? '')
    scheduleHydrate()
  }, [initialText])

  useEffect(() => {
    if (!readyRef.current) return
    scheduleHydrate()
  }, [filePath])

  useEffect(
    () => () => {
      flushSave()
      if (hydrateTimerRef.current !== null) {
        window.clearTimeout(hydrateTimerRef.current)
        hydrateTimerRef.current = null
      }
      revokeMarkdownImageBlobs(blobCacheRef.current)
      const vditor = vditorRef.current
      vditorRef.current = null
      if (!vditor || !readyRef.current) return
      try {
        vditor.destroy()
      } catch (error) {
        console.error('[APP-ERROR] vditor destroy failed', error)
      }
      readyRef.current = false
    },
    [flushSave]
  )

  if (file.loading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Spin />
      </div>
    )
  }

  if (file.loadError || file.initialText === null) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={file.loadError || '文件加载失败'} />
      </div>
    )
  }

  return (
    <>
      <div
        ref={rootRef}
        className="h-full w-full overflow-hidden bg-white"
        data-testid={workbenchSelectors.markdownEditor}
      />
      <ImageLightbox image={previewImage} onClose={() => setPreviewImage(null)} />
    </>
  )
}

export default React.memo(MarkdownEditor)
