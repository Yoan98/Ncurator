import type { FC } from 'react'
import { getFileIconKind, getFileIconPaths, type FileIconKind } from '../utils/fileIcons'

type FileIconProps = {
  name?: string
  extension?: string
  kind?: FileIconKind
  expanded?: boolean
  className?: string
}

const FileIcon: FC<FileIconProps> = ({
  name = '',
  extension,
  kind,
  expanded,
  className = 'h-4 w-4 shrink-0 text-[#787774]'
}) => {
  const iconKind = kind || getFileIconKind(name, extension)
  return (
    <svg
      aria-hidden="true"
      data-file-icon={iconKind}
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {getFileIconPaths(iconKind, expanded).map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export default FileIcon
