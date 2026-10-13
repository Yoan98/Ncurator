import { useEffect, useRef, type FC } from 'react'
import FileIcon from '../FileIcon'

type FileNameInputProps = {
  value: string
  suffix: string
  renaming: boolean
  busy: boolean
  error: string | null
  onChange: (name: string) => void
  onSubmit: () => void
  onCancel: () => void
}

const FileNameInput: FC<FileNameInputProps> = ({
  value,
  suffix,
  renaming,
  busy,
  error,
  onChange,
  onSubmit,
  onCancel
}) => {
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = inputRef.current
    input?.focus()
    input?.setSelectionRange(0, input.value.length - suffix.length)
    input?.scrollIntoView({ block: 'nearest' })
    // Select the basename once when this editor is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clampSelection = (input: HTMLInputElement): void => {
    if (!suffix) return
    const end = input.value.length - suffix.length
    const start = Math.min(input.selectionStart || 0, end)
    const finish = Math.min(input.selectionEnd || 0, end)
    if (input.selectionStart !== start || input.selectionEnd !== finish)
      input.setSelectionRange(start, finish)
  }

  return (
    <>
      <div className="flex h-[30px] items-center gap-1.5 rounded-[6px] border border-[#0B6BCB] bg-white px-1.5 text-[13px] shadow-[0_0_0_2px_rgba(11,107,203,0.08)]">
        <FileIcon name={value} />
        <input
          ref={inputRef}
          aria-label={renaming ? '重命名文件名' : '新建文件名'}
          aria-invalid={Boolean(error)}
          value={value}
          disabled={busy}
          placeholder="文件名.后缀"
          className="min-w-0 flex-1 bg-transparent text-[#37352F] outline-none"
          onSelect={(event) => clampSelection(event.currentTarget)}
          onChange={(event) => {
            const name = event.target.value
            onChange(!suffix || name.endsWith(suffix) ? name : `${name}${suffix}`)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              event.stopPropagation()
              if (!busy) onCancel()
            } else if (
              event.key === 'Enter' &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault()
              onSubmit()
            } else if (
              suffix &&
              event.key === 'Delete' &&
              event.currentTarget.selectionStart === value.length - suffix.length
            ) {
              event.preventDefault()
            }
          }}
        />
      </div>
      {error ? (
        <div role="alert" className="mt-1 text-xs text-[#B3261E]">
          {error}
        </div>
      ) : null}
    </>
  )
}

export default FileNameInput
