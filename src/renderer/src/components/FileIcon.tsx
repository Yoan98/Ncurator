import type { FC } from 'react'
import { HiOutlineMusicalNote, HiOutlineVideoCamera } from 'react-icons/hi2'
import { PiFileMdLight, PiFileTextLight } from 'react-icons/pi'
import { BsFolder, BsFolder2Open } from 'react-icons/bs'
import { LuGlobe } from 'react-icons/lu'
import {
  FILE_ICON_SIZE_CLASSES,
  DIRECTORY_ICON_SIZE_CLASSES,
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

const FileIcon: FC<FileIconProps> = ({ name = '', extension, kind, expanded, className }) => {
  const iconKind = kind || getFileIconKind(name, extension)
  const visualSpec = getFileVisualSpec(iconKind)
  const iconProps = {
    'aria-hidden': true as const,
    'data-file-icon': iconKind,
    className:
      className ||
      `${iconKind === 'directory' ? DIRECTORY_ICON_SIZE_CLASSES.sm : FILE_ICON_SIZE_CLASSES.sm} shrink-0 text-[#787774]`
  }
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
        ? BsFolder2Open
        : BsFolder
      : iconKind === 'audio'
        ? HiOutlineMusicalNote
        : iconKind === 'video'
          ? HiOutlineVideoCamera
          : iconKind === 'web'
            ? LuGlobe
            : iconKind === 'markdown'
              ? PiFileMdLight
              : PiFileTextLight
  return <Icon {...iconProps} />
}

export default FileIcon
