import FileIcon from '../../FileIcon'
import { DIRECTORY_ICON_SIZE_CLASSES, FILE_ICON_SIZE_CLASSES } from '../../../utils/fileIcons'
import DocumentFileGlyph from '../../DocumentFileGlyph'
import React from 'react'
import { HiOutlineMusicalNote, HiOutlineVideoCamera } from 'react-icons/hi2'
import type { SelectedReference } from '../../../../../shared/types'
import { getReferenceVisualSpec } from './referenceVisuals'

type ReferenceIconProps = {
  reference: SelectedReference
  size?: 'sm' | 'md' | 'inline'
}

const containerSizeClassName = {
  sm: 'h-[22px] w-[22px]',
  md: 'h-8 w-8',
  inline: 'relative top-[0.15em] h-[18px] w-[18px]'
} as const

const ReferenceIcon: React.FC<ReferenceIconProps> = ({ reference, size = 'md' }) => {
  const visualSpec = getReferenceVisualSpec(reference)
  const iconSize =
    visualSpec.kind === 'directory'
      ? DIRECTORY_ICON_SIZE_CLASSES[size]
      : FILE_ICON_SIZE_CLASSES[size]
  const iconClassName = `${iconSize} ${visualSpec.iconClassName}`

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center ${containerSizeClassName[size]}`}
      data-reference-icon-kind={visualSpec.kind}
    >
      {['directory', 'markdown', 'file'].includes(visualSpec.kind) ? (
        <FileIcon kind={visualSpec.kind} className={iconClassName} />
      ) : visualSpec.kind === 'audio' ? (
        <HiOutlineMusicalNote className={iconClassName} />
      ) : visualSpec.kind === 'video' ? (
        <HiOutlineVideoCamera className={iconClassName} />
      ) : visualSpec.kind !== 'directory' && visualSpec.kind !== 'web' ? (
        <DocumentFileGlyph
          className={iconClassName}
          fillClassName={visualSpec.documentFillClassName}
          accentClassName={visualSpec.documentAccentClassName}
          label={visualSpec.documentLabel}
        />
      ) : (
        <svg
          className={iconClassName}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.15 2.2 3.2 5.05 3.2 8.5s-1.05 6.3-3.2 8.5M12 3.5C9.85 5.7 8.8 8.55 8.8 12s1.05 6.3 3.2 8.5" />
        </svg>
      )}
    </span>
  )
}

export default ReferenceIcon
