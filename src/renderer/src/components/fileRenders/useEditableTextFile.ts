import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import { sha256Hex } from '../../utils/fileHash'

const AUTO_SAVE_DEBOUNCE_MS = 400

type LoadState = {
  loading: boolean
  text: string | null
  hash: string | null
  error: string | null
}

export type EditableTextFile = {
  loading: boolean
  loadError: string | null
  initialText: string | null
  /** 注册一次内容变更并安排防抖自动保存（纯覆盖）。 */
  autoSave: (content: string) => void
  /** 立即保存挂起的改动并清空防抖。 */
  flushSave: () => void
  reload: () => Promise<void>
}

const decodeUtf8 = (bytes: Uint8Array): string => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
}

const detectHadBom = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf

const applyOriginalFormat = (content: string, eol: 'lf' | 'crlf', hadBom: boolean): string => {
  let output = content
  if (eol === 'crlf') output = output.replace(/\r?\n/g, '\r\n')
  if (hadBom) output = `\uFEFF${output}`
  return output
}

/**
 * 应用内文本编辑的加载、自动保存与外部改动协调。
 * - 自动保存纯覆盖：每次内容变更防抖后写入磁盘，不做冲突提示。
 * - 外部改动：磁盘与"最后成功写入的 hash"不同且当前无未保存改动时自动重载；
 *   存在未保存改动时不打断编辑，下一次自动保存覆盖外部内容。
 */
export const useEditableTextFile = (filePath: string): EditableTextFile => {
  const [state, setState] = useState<LoadState>({
    loading: true,
    text: null,
    hash: null,
    error: null
  })

  const filePathRef = useRef(filePath)
  const lastWrittenHashRef = useRef<string | null>(null)
  const unsavedRef = useRef(false)
  const pendingContentRef = useRef<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const eolRef = useRef<'lf' | 'crlf'>('lf')
  const hadBomRef = useRef(false)

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const clearSaveTimer = useCallback((): void => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const doSave = useCallback(async (content: string): Promise<void> => {
    try {
      const formattedContent = applyOriginalFormat(content, eolRef.current, hadBomRef.current)
      const response = await window.api.writeTextFile({
        filePath: filePathRef.current,
        content: formattedContent
      })
      if (response.success && response.hash) {
        lastWrittenHashRef.current = response.hash
        if (pendingContentRef.current === content) pendingContentRef.current = null
        unsavedRef.current = false
      } else {
        console.error('[EDITABLE-FILE] auto-save failed', response.error)
      }
    } catch (error) {
      console.error('[EDITABLE-FILE] auto-save failed', error)
    }
  }, [])

  const flushSave = useCallback((): void => {
    clearSaveTimer()
    if (pendingContentRef.current !== null) {
      const content = pendingContentRef.current
      pendingContentRef.current = null
      void doSave(content)
    }
  }, [clearSaveTimer, doSave])

  const autoSave = useCallback(
    (content: string): void => {
      unsavedRef.current = true
      pendingContentRef.current = content
      clearSaveTimer()
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        const pending = pendingContentRef.current
        if (pending !== null) {
          pendingContentRef.current = null
          void doSave(pending)
        }
      }, AUTO_SAVE_DEBOUNCE_MS)
    },
    [clearSaveTimer, doSave]
  )

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const bytes = await window.api.readFile(filePathRef.current)
      const hash = await sha256Hex(bytes)
      const text = decodeUtf8(bytes)
      hadBomRef.current = detectHadBom(bytes)
      eolRef.current = /\r\n/.test(text) ? 'crlf' : 'lf'
      lastWrittenHashRef.current = hash
      unsavedRef.current = false
      pendingContentRef.current = null
      setState({ loading: false, text, hash, error: null })
    } catch (error) {
      setState({
        loading: false,
        text: null,
        hash: null,
        error: normalizeUserFacingError(error, '文件加载失败')
      })
    }
  }, [])

  const checkExternalChange = useCallback(async (): Promise<void> => {
    try {
      const bytes = await window.api.readFile(filePathRef.current)
      const currentHash = await sha256Hex(bytes)
      if (currentHash === lastWrittenHashRef.current) return
      if (unsavedRef.current) return
      await load()
    } catch (error) {
      console.error('[EDITABLE-FILE] external change check failed', error)
    }
  }, [load])

  useEffect(() => {
    let disposed = false
    let watchId: string | null = null

    const handleExternalChange = (): void => {
      if (disposed) return
      void checkExternalChange()
    }

    const unsubscribe = window.api.onFileWatchChange((event) => {
      if (event.watchId === watchId) handleExternalChange()
    })

    const startWatch = async (): Promise<void> => {
      const response = await window.api.fileWatchStart({ filePath: filePathRef.current })
      if (!response.success || !response.watchId) return
      if (disposed) {
        await window.api.fileWatchStop({ watchId: response.watchId }).catch(() => undefined)
        return
      }
      watchId = response.watchId
    }

    const checkOnFocus = (): void => {
      if (!watchId) return
      void window.api.fileWatchCheck({ watchId }).then((response) => {
        if (response.success && response.changed) handleExternalChange()
      })
    }

    void load()
    void startWatch()
    const onFocus = (): void => checkOnFocus()
    const onVisibility = (): void => {
      if (!document.hidden) checkOnFocus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      unsubscribe()
      clearSaveTimer()
      if (pendingContentRef.current !== null) {
        const pending = pendingContentRef.current
        pendingContentRef.current = null
        void doSave(pending)
      }
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      if (watchId) void window.api.fileWatchStop({ watchId }).catch(() => undefined)
    }
  }, [checkExternalChange, clearSaveTimer, doSave, load, filePath])

  return {
    loading: state.loading,
    loadError: state.error,
    initialText: state.text,
    autoSave,
    flushSave,
    reload: load
  }
}
