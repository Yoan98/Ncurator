import { useCallback, useContext, useMemo } from 'react'
import { DocumentSelectionContext } from '../workbench/composer/DocumentSelectionContext'
import DocumentSelectionLayer from './selection/DocumentSelectionLayer'
import { markdownAdapter } from './selection/textFileAdapter'
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
import { openMarkdownEditorLink } from './markdownEditorLinks'
import ImageLightbox from '../workbench/ImageLightbox'
import type { ImageLightboxImage } from '../workbench/ImageLightbox'
import { workbenchSelectors } from '../../testing/selectors'

const resolveVditorCdn = (): string => new URL('vditor', document.baseURI).href

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
  const vditorRef = useRef<Vditor | null>(null)
  const readyRef = useRef(false)
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
        message.warning('图片无法加载')
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
          message.warning('链接无法访问')
          return
        }
        message.warning(result.detail || '无法打开链接')
      })
    }
  }, [message])

  useEffect(() => {
    if (selectionState?.locked) vditorRef.current?.disabled()
    else vditorRef.current?.enable()
  }, [selectionState?.locked])

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

  const destroyVditor = (): void => {
    const vditor = vditorRef.current
    vditorRef.current = null
    readyRef.current = false
    if (!vditor) return
    try {
      vditor.destroy()
    } catch (error) {
      console.error('[APP-ERROR] vditor destroy failed', error)
    }
  }

  // filePath 变化或卸载时必须销毁，否则 loading 换掉 DOM 后 vditorRef 仍在，会跳过重建导致空白
  useEffect(() => () => destroyVditor(), [filePath])

  useEffect(() => {
    if (initialText === null || !rootRef.current || vditorRef.current) return
    readyRef.current = false
    rootRef.current.replaceChildren()
    const vditor = new Vditor(rootRef.current, {
      mode: 'ir',
      lang: 'zh_CN',
      i18n: vditorI18n,
      toolbar: [],
      cache: { enable: false },
      value: initialText,
      cdn: resolveVditorCdn(),
      placeholder: '开始输入…',
      link: {
        click: (element) => {
          linkHandlerRef.current(element)
        }
      },
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
      void flushSave().catch((error) => console.error('文件保存失败', error))
      if (hydrateTimerRef.current !== null) {
        window.clearTimeout(hydrateTimerRef.current)
        hydrateTimerRef.current = null
      }
      revokeMarkdownImageBlobs(blobCacheRef.current)
      destroyVditor()
    },
    [flushSave]
  )

  if (file.loadError || (!file.loading && file.initialText === null)) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-white">
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={file.loadError || '文件加载失败'}
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
      <div
        ref={bindRoot}
        className="h-full w-full overflow-hidden bg-white"
        data-testid={workbenchSelectors.markdownEditor}
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
