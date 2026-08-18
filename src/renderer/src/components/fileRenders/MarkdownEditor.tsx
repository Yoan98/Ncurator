import React, { useCallback, useEffect, useRef } from 'react'
import { Empty, Spin, message } from 'antd'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import '@milkdown/crepe/theme/common/style.css'
import './markdownEditor.css'
import { useEditableTextFile } from './useEditableTextFile'
import { registerEditableFileDirty } from './editableDirtyRegistry'
import { EditableFileSurface } from './EditableFileSurface'
import { workbenchSelectors } from '../../testing/selectors'

const MarkdownEditorInner: React.FC<{
  initialContent: string
  onEditorReady: (crepe: Crepe | null) => void
  onMarkdownChange: (markdown: string) => void
}> = ({ initialContent, onEditorReady, onMarkdownChange }) => {
  const onEditorReadyRef = useRef(onEditorReady)
  const onMarkdownChangeRef = useRef(onMarkdownChange)

  useEffect(() => {
    onEditorReadyRef.current = onEditorReady
    onMarkdownChangeRef.current = onMarkdownChange
  })

  useEditor(
    (root) => {
      const crepe = new Crepe({
        root,
        defaultValue: initialContent,
        features: {
          [Crepe.Feature.TopBar]: false,
          [Crepe.Feature.AI]: false
        }
      })
      crepe.on((listener) => {
        listener.markdownUpdated((_ctx, markdown, prevMarkdown) => {
          if (markdown !== prevMarkdown) onMarkdownChangeRef.current(markdown)
        })
      })
      onEditorReadyRef.current(crepe)
      return crepe
    },
    [initialContent]
  )

  useEffect(
    () => () => {
      onEditorReadyRef.current(null)
    },
    [initialContent]
  )

  return (
    <div
      className="h-full w-full overflow-y-auto px-8 py-6"
      data-testid={workbenchSelectors.markdownEditor}
    >
      <Milkdown />
    </div>
  )
}

const MarkdownEditor: React.FC<{ filePath: string }> = ({ filePath }) => {
  const file = useEditableTextFile(filePath)
  const crepeRef = useRef<Crepe | null>(null)
  const { initialText, setDirty } = file

  const handleEditorReady = useCallback((crepe: Crepe | null): void => {
    crepeRef.current = crepe
  }, [])

  const handleMarkdownChange = useCallback(
    (markdown: string): void => {
      setDirty(markdown !== (initialText ?? ''))
    },
    [initialText, setDirty]
  )

  const saveContent = useCallback(
    async (options?: { force?: boolean }): Promise<void> => {
      const crepe = crepeRef.current
      if (!crepe) return
      const result = await file.save(crepe.getMarkdown(), options)
      if (result.ok) {
        message.success('已保存')
      } else if (result.conflict) {
        message.warning(result.error || '文件已被外部修改')
      } else {
        message.error(result.error || '保存失败')
      }
    },
    [file]
  )

  const handleSave = useCallback((): void => {
    void saveContent()
  }, [saveContent])

  const handleForceSave = useCallback((): void => {
    void saveContent({ force: true })
  }, [saveContent])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleSave])

  useEffect(() => {
    registerEditableFileDirty(filePath, file.dirty)
    return () => registerEditableFileDirty(filePath, false)
  }, [filePath, file.dirty])

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
    <EditableFileSurface
      file={file}
      saveDisabled={!file.dirty}
      onSave={handleSave}
      onForceSave={handleForceSave}
      onReload={() => void file.reload()}
    >
      <MilkdownProvider>
        <MarkdownEditorInner
          initialContent={file.initialText}
          onEditorReady={handleEditorReady}
          onMarkdownChange={handleMarkdownChange}
        />
      </MilkdownProvider>
    </EditableFileSurface>
  )
}

export default React.memo(MarkdownEditor)
