import type { FC } from 'react'
import { HiOutlineMusicalNote, HiOutlineVideoCamera } from 'react-icons/hi2'
import { BiSolidFile, BiSolidFileMd } from 'react-icons/bi'
import { LuFolder, LuFolderOpen, LuGlobe } from 'react-icons/lu'
import {
  FILE_ICON_SIZE_CLASSES,
  getFileIconKind,
  getFileVisualSpec,
  type FileIconKind
} from '../utils/fileIcons'
import DocumentFileGlyph from './DocumentFileGlyph'

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
  className = `${FILE_ICON_SIZE_CLASSES.sm} shrink-0 text-[#787774]`
}) => {
  const iconKind = kind || getFileIconKind(name, extension)
  const visualSpec = getFileVisualSpec(iconKind)
  const iconProps = { 'aria-hidden': true as const, 'data-file-icon': iconKind, className }
  if (['docx', 'xlsx', 'ppt', 'pdf'].includes(iconKind)) {
    return (
      <DocumentFileGlyph
        {...iconProps}
        fillClassName={visualSpec.documentFillClassName}
        accentClassName={visualSpec.documentAccentClassName}
        label={visualSpec.documentLabel}
      />
    )
  }
  const Icon =
    iconKind === 'directory'
      ? expanded
        ? LuFolderOpen
        : LuFolder
      : iconKind === 'audio'
        ? HiOutlineMusicalNote
        : iconKind === 'video'
          ? HiOutlineVideoCamera
          : iconKind === 'web'
            ? LuGlobe
            : iconKind === 'markdown'
              ? BiSolidFileMd
              : BiSolidFile
  return <Icon {...iconProps} />
}

export default FileIcon
