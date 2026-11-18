import React from 'react'
import type { IconType } from 'react-icons'
import { LuFolder, LuGlobe } from 'react-icons/lu'
import {
  PiFileAudioLight,
  PiFileDocLight,
  PiFileImageLight,
  PiFileMdLight,
  PiFilePdfLight,
  PiFilePptLight,
  PiFileTextLight,
  PiFileVideoLight,
  PiFileXlsLight
} from 'react-icons/pi'
import {
  findMarkdownLinkAccess,
  transformAssistantMarkdownUrl,
  repairMarkdownLinkDestinations,
  resolveMarkdownLinkForRender,
  type OpenableMarkdownReference,
  type ResolvedMarkdownLink
} from '../../../shared/markdownLink'
import {
  normalizeNcuratorRefMarkdownLinks,
  repairInlineCodeWrappedNcuratorLinks
} from '../../../shared/ncuratorRef'
import type { MarkdownLinkResourceType } from '../../../shared/types'
import { getFileIconKind, type FileIconKind } from '../utils/fileIcons'
export type { OpenableMarkdownReference, ResolvedMarkdownLink }
export {
  findMarkdownLinkAccess,
  repairMarkdownLinkDestinations,
  resolveMarkdownLinkForRender,
  transformAssistantMarkdownUrl
}
export const normalizeRefMarkdownLinks = normalizeNcuratorRefMarkdownLinks
export { repairInlineCodeWrappedNcuratorLinks }

const REFERENCE_ICON_BY_KIND: Record<FileIconKind, IconType> = {
  directory: LuFolder,
  web: LuGlobe,
  pdf: PiFilePdfLight,
  docx: PiFileDocLight,
  xlsx: PiFileXlsLight,
  ppt: PiFilePptLight,
  audio: PiFileAudioLight,
  video: PiFileVideoLight,
  image: PiFileImageLight,
  markdown: PiFileMdLight,
  file: PiFileTextLight
}

/** Inline reference glyph keyed by link kind (web) or target file type. */
export const renderReferenceIcon = (input: {
  resourceType: MarkdownLinkResourceType
  path: string
}): React.ReactNode => {
  const Icon =
    input.resourceType === 'web'
      ? REFERENCE_ICON_BY_KIND.web
      : REFERENCE_ICON_BY_KIND[getFileIconKind(input.path)]
  return <Icon aria-hidden />
}
