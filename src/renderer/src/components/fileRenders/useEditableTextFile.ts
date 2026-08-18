import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeUserFacingError } from '../../utils/userFacingError'
import { sha256Hex } from '../../utils/fileHash'

export type SaveEditableResult = {
  ok: boolean
  conflict: boolean
  error?: string
}

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
  initialHash: string | null
  dirty: boolean
  saving: boolean
  externalConflict: boolean
  setDirty: (dirty: boolean) => void
  reload: () => Promise<void>
  save: (content: string, options?: { force?: boolean }) => Promise<SaveEditableResult>
  clearConflict: () => void
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

export const useEditableTextFile = (filePath: string): EditableTextFile => {
  const [state, setState] = useState<LoadState>({
    loading: true,
    text: null,
    hash: null,
    error: null
  })
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [externalConflict, setExternalConflict] = useState(false)

  const filePathRef = useRef(filePath)
  const hashRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)
  const eolRef = useRef<'lf' | 'crlf'>('lf')
  const hadBomRef = useRef(false)

  filePathRef.current = filePath
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])

  const load = useCallback(async (): Promise<void> => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const bytes = await window.api.readFile(filePathRef.current)
      const hash = await sha256Hex(bytes)
      const text = decodeUtf8(bytes)
      hadBomRef.current = detectHadBom(bytes)
      eolRef.current = /\r\n/.test(text) ? 'crlf' : 'lf'
      hashRef.current = hash
      setDirty(false)
      setExternalConflict(false)
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
      if (currentHash === hashRef.current) return
      if (dirtyRef.current) {
        setExternalConflict(true)
      } else {
        await load()
      }
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
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
      if (watchId) void window.api.fileWatchStop({ watchId }).catch(() => undefined)
    }
  }, [checkExternalChange, load, filePath])

  const save = useCallback(
    async (content: string, options?: { force?: boolean }): Promise<SaveEditableResult> => {
      setSaving(true)
      try {
        const formattedContent = applyOriginalFormat(content, eolRef.current, hadBomRef.current)
        const response = await window.api.writeTextFile({
          filePath: filePathRef.current,
          content: formattedContent,
          expectedHash: options?.force ? undefined : hashRef.current || undefined
        })
        if (!response.success) {
          if (response.conflict) {
            setExternalConflict(true)
            return { ok: false, conflict: true, error: response.error }
          }
          return { ok: false, conflict: false, error: response.error || '保存失败' }
        }
        if (response.hash) hashRef.current = response.hash
        setDirty(false)
        setExternalConflict(false)
        return { ok: true, conflict: false }
      } catch (error) {
        return {
          ok: false,
          conflict: false,
          error: normalizeUserFacingError(error, '保存失败')
        }
      } finally {
        setSaving(false)
      }
    },
    []
  )

  const clearConflict = useCallback(() => {
    setExternalConflict(false)
  }, [])

  return {
    loading: state.loading,
    loadError: state.error,
    initialText: state.text,
    initialHash: state.hash,
    dirty,
    saving,
    externalConflict,
    setDirty,
    reload: load,
    save,
    clearConflict
  }
}
