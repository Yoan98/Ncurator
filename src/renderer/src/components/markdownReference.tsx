import React from 'react'
import FileIcon from './FileIcon'
import { getFileIconKind, getFileVisualSpec } from '../utils/fileIcons'
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
export type { OpenableMarkdownReference, ResolvedMarkdownLink }
export {
  findMarkdownLinkAccess,
  repairMarkdownLinkDestinations,
  resolveMarkdownLinkForRender,
  transformAssistantMarkdownUrl
}
export const normalizeRefMarkdownLinks = normalizeNcuratorRefMarkdownLinks
export { repairInlineCodeWrappedNcuratorLinks }

/** All file-reference surfaces use the same glyph mapping. */
export const renderReferenceIcon = (input: {
  resourceType: MarkdownLinkResourceType
  path: string
}): React.ReactNode => {
  const fileKind = getFileIconKind(input.path)
  const kind = input.resourceType === 'web' && fileKind === 'file' ? 'web' : fileKind
  return (
    <FileIcon
      kind={kind}
      className={`h-[18px] w-[18px] shrink-0 ${getFileVisualSpec(kind).iconClassName}`}
    />
  )
}
